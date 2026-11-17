import os
import re
import httpx
import logging
from typing import Dict, Any, List, Optional
from config import (
    DOVESOFT_WHATSAPP_URL,
    DOVESOFT_WABA_NUMBER,
    DOVESOFT_API_KEY,
    DOVESOFT_WHATSAPP_DEFAULT_TEMPLATE,
    DOVESOFT_WHATSAPP_TEXT_TEMPLATE,
    DOVESOFT_WHATSAPP_AUDIO_TEMPLATE,
    DOVESOFT_WHATSAPP_IMAGE_TEMPLATE,
    DOVESOFT_WHATSAPP_VIDEO_TEMPLATE,
)

logger = logging.getLogger("lucid.whatsapp_service")


class WhatsAppService:
    """
    Service for sending WhatsApp messages via DoveSoft REST Direct API.
    Uses approved Meta/DoveSoft templates ('video_type_template', 'sample_image_template', 'sample_shipping_confirmation', etc.).
    """

    def __init__(self):
        self.api_url = DOVESOFT_WHATSAPP_URL or "https://api.dovesoft.io/REST/directApi/message"
        self.waba_number = DOVESOFT_WABA_NUMBER or "918448555602"
        self.api_key = DOVESOFT_API_KEY or ""
        self.text_template = DOVESOFT_WHATSAPP_TEXT_TEMPLATE or "lucid_audio"
        self.audio_template = DOVESOFT_WHATSAPP_AUDIO_TEMPLATE or "lucid_audio1"
        self.image_template = DOVESOFT_WHATSAPP_IMAGE_TEMPLATE or "lucid_image"
        self.video_template = DOVESOFT_WHATSAPP_VIDEO_TEMPLATE or "lucid_video"
        self.default_template = DOVESOFT_WHATSAPP_DEFAULT_TEMPLATE or "lucid_video"
        self.fallback_media_url = "https://rest.dovesoft.io//tempMediaFiles/testVideo.mp4"
        self.fallback_image_url = "https://rest.dovesoft.io//tempMediaFiles/image.jpeg"

    @staticmethod
    def normalize_phone_number(raw_phone: str) -> str:
        """
        Normalizes phone number to format expected by DoveSoft (digits only, e.g. 91XXXXXXXXXX).
        Strips '+', spaces, and dashes. Prepends 91 if 10-digit number.
        """
        digits = "".join(filter(str.isdigit, str(raw_phone or "")))
        if len(digits) == 10:
            return f"91{digits}"
        return digits

    @staticmethod
    def sanitize_template_param(value: Any, max_length: int = 1000, strip_urls: bool = True) -> str:
        """
        Meta WhatsApp Template parameters (e.g. {{1}}, {{2}}) strictly forbid line breaks
        (\\n or \\r) and more than 4 consecutive spaces.
        Convert multiline strings into clean single-line strings with bullet points.
        Also automatically shortens long URLs into clean short links.
        """
        text = str(value or "").strip()
        if not text:
            return ""
        if strip_urls:
            import re
            text = re.sub(r'https?://\S+', '', text).strip()
            text = re.sub(r'🎬\s*\*?Watch Video:\*?', '', text).strip()
            text = re.sub(r'🎧\s*\*?Listen to Audio Lesson:\*?', '', text).strip()

        lines = [line.strip() for line in text.splitlines() if line.strip()]
        sanitized = " • ".join(lines)
        import re
        sanitized = re.sub(r"\s{2,}", " ", sanitized)
        # Strip trailing bullet separators left behind by URL formatting
        sanitized = re.sub(r"(?:\s*•\s*)+$", "", sanitized).strip()
        if len(sanitized) > max_length:
            sanitized = sanitized[:max_length - 3] + "..."
        return sanitized

    async def send_template_message(
        self,
        recipient_phone: str,
        user_name: str,
        message_body: str,
        media_url: Optional[str] = None,
        media_type: Optional[str] = None,
        template_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send an approved WhatsApp template message via DoveSoft.
        
        Args:
            recipient_phone: Target mobile number (e.g., 919876543210 or +91 98765 43210)
            user_name: Recipient / Learner name (mapped to BODY parameter 1: value1)
            message_body: Notification / Nudge content (mapped to BODY parameter 2: value2)
            media_url: Direct URL to image/video/audio/document (mapped to HEADER parameter)
            media_type: 'video', 'image', 'audio', 'document'
            template_name: Approved template name ('lucid_image', 'lucid_audio', 'whatsapp_lucid', etc.)
        """
        to_phone = self.normalize_phone_number(recipient_phone)
        if not to_phone:
            return {
                "success": False,
                "message_id": None,
                "error": "Recipient phone number is missing or invalid.",
            }

        active_media_url = None
        active_media_type = None

        if media_url:
            active_media_url = str(media_url).strip()
            if media_type:
                active_media_type = media_type.lower()
            else:
                lower_url = active_media_url.lower()
                if any(lower_url.endswith(ext) or ext in lower_url for ext in [".mp4", ".mov", ".avi"]):
                    active_media_type = "video"
                elif any(lower_url.endswith(ext) or ext in lower_url for ext in [".jpg", ".jpeg", ".png", ".webp", ".svg"]):
                    active_media_type = "image"
                elif any(lower_url.endswith(ext) or ext in lower_url for ext in [".mp3", ".wav", ".m4a", ".aac"]):
                    active_media_type = "audio"
                elif any(lower_url.endswith(ext) or ext in lower_url for ext in [".pdf", ".doc", ".docx"]):
                    active_media_type = "document"
                else:
                    active_media_type = "image"
        elif media_type == "video":
            # Explicitly requested video but no URL provided: use fallback video
            active_media_url = self.fallback_media_url
            active_media_type = "video"
        elif media_type == "image":
            active_media_url = self.fallback_image_url
            active_media_type = "image"
        elif media_type == "audio":
            active_media_type = "audio"

        # Determine template based on selected content/media
        if template_name:
            tpl_name = template_name
        elif active_media_type == "video" and active_media_url:
            tpl_name = self.video_template
        elif active_media_type == "image":
            tpl_name = self.image_template
        elif active_media_type == "audio":
            tpl_name = self.audio_template
        else:
            tpl_name = self.text_template

        # Meta template language policy
        if tpl_name == "sample_shipping_confirmation":
            lang_code = "en_us"
        else:
            lang_code = "en"

        clean_user_name = self.sanitize_template_param(user_name or "Learner", max_length=60)
        clean_message_body = self.sanitize_template_param(message_body or "You have a new training update.", max_length=1000)

        # The WhatsApp template format already includes "Hii" and the user's name (parameter 1).
        # Strip any redundant greetings like "Hey there", "Hi there", "Hello there", "Hey", "Hi" from message body
        clean_message_body = re.sub(
            r'^(?:hey\s+there|hi\s+there|hello\s+there|hey|hi|hello|greetings)[!,\.\s\-:]*',
            '',
            clean_message_body,
            flags=re.IGNORECASE
        ).strip()
        clean_message_body = re.sub(r'\bhey\s+there\b[,!.]*\s*', '', clean_message_body, flags=re.IGNORECASE).strip()
        if clean_message_body and clean_message_body[0].islower():
            clean_message_body = clean_message_body[0].upper() + clean_message_body[1:]

        components = []

        if tpl_name == "lucid_image":
            # Approved Image Template (for flashcards, mindmaps, infographics)
            # HEADER (image) + BODY (single text parameter)
            components.append({
                "type": "HEADER",
                "parameters": [
                    {
                        "type": "image",
                        "image": {
                            "link": active_media_url or self.fallback_image_url
                        }
                    }
                ]
            })
            components.append({
                "type": "BODY",
                "parameters": [
                    {
                        "type": "text",
                        "text": clean_message_body or "Your learning module is ready."
                    }
                ]
            })
        elif tpl_name in ["lucid_audio1", "lucid_audio2"]:
            # Approved Audio Template with CTA dynamic URL button (lucid_audio1, lucid_audio2)
            # Template text in Meta is:
            # "Hi {{1}},\n\nThanks,\nTeam Lucid\n\n[Play !]"
            # We format parameter 1 to seamlessly include both User Name and the Generated Nudge Message:
            # e.g. "Hi Monalika! Ready to master the art of making every guest feel truly heard?...,"
            if clean_message_body:
                if clean_user_name:
                    body_text = f"{clean_user_name}! {clean_message_body}"
                else:
                    body_text = clean_message_body
            else:
                body_text = clean_user_name or "Learner"

            body_text = self.sanitize_template_param(body_text, max_length=1000)

            components.append({
                "type": "BODY",
                "parameters": [
                    {
                        "type": "text",
                        "text": body_text
                    }
                ]
            })

            button_url = str(active_media_url or "").strip()
            # The Meta template 'lucid_audio1' dynamic button has Base URL:
            # https://fmkikkebrxyzjsffqgex.supabase.co/storage/v1/object/public/module_audio/
            # Meta dynamic URL buttons strictly reject or drop variables that contain slashes ('/').
            # Therefore, we ensure the file is copied to the root of the 'module_audio' bucket,
            # and pass ONLY the clean filename without any slashes (e.g. '5210bdc3-...wav').
            clean_filename = button_url.split("/")[-1].split("?")[0]
            if clean_filename:
                try:
                    from utils.supabase_client import supabase_admin
                    source_key = ""
                    if "/module_audio/" in button_url:
                        source_key = button_url.split("/module_audio/", 1)[1].split("?")[0]
                    elif "/object/public/" in button_url:
                        parts = button_url.split("/object/public/", 1)[1].split("/", 1)
                        if len(parts) > 1:
                            source_key = parts[1].split("?")[0]

                    if source_key and source_key != clean_filename:
                        logger.info(f"[DoveSoft WhatsApp] Ensuring audio file is at root of module_audio bucket: {source_key} -> {clean_filename}")
                        try:
                            supabase_admin.storage.from_("module_audio").copy(source_key, clean_filename)
                        except Exception as c_err:
                            # Might already exist at destination
                            logger.info(f"[DoveSoft WhatsApp] Copy notice: {c_err}")
                except Exception as copy_err:
                    logger.warning(f"[DoveSoft WhatsApp] Could not copy audio to root of module_audio: {copy_err}")

                button_url = clean_filename

            components.append({
                "sub_type": "url",
                "index": 0,
                "type": "button",
                "parameters": [
                    {
                        "type": "text",
                        "text": button_url
                    }
                ]
            })
        elif tpl_name == "lucid_audio":
            # Approved Audio Template (for audio lessons, text-only fallback)
            # NO header, BODY (single text parameter)
            components.append({
                "type": "BODY",
                "parameters": [
                    {
                        "type": "text",
                        "text": clean_message_body or "Your audio lesson is ready."
                    }
                ]
            })
        elif tpl_name == "lucid_video":
            # Approved Video Template (lucid_video)
            # HEADER (video) + BODY (single text parameter: message_body)
            components.append({
                "type": "HEADER",
                "parameters": [
                    {
                        "video": {
                            "link": active_media_url or self.fallback_media_url
                        },
                        "type": "video"
                    }
                ]
            })
            components.append({
                "type": "BODY",
                "parameters": [
                    {
                        "type": "text",
                        "text": clean_message_body or "Your sprint video lesson is ready."
                    }
                ]
            })
        elif tpl_name == "whatsapp_lucid":
            # Approved Video Template (for video lessons)
            # HEADER (video) + BODY (2 text parameters: user_name, message_body)
            components.append({
                "type": "HEADER",
                "parameters": [
                    {
                        "type": "video",
                        "video": {
                            "link": active_media_url or self.fallback_media_url
                        }
                    }
                ]
            })
            components.append({
                "type": "BODY",
                "parameters": [
                    {
                        "type": "text",
                        "text": clean_user_name or "Learner"
                    },
                    {
                        "type": "text",
                        "text": clean_message_body or "Your sprint video lesson is ready."
                    }
                ]
            })
        elif tpl_name == "sample_shipping_confirmation":
            # Text-only template
            components.append({
                "type": "BODY",
                "parameters": [
                    {
                        "type": "text",
                        "text": "6-7"
                    }
                ]
            })
        elif tpl_name == "sample_image_template":
            # Image template
            components.append({
                "type": "HEADER",
                "parameters": [
                    {
                        "type": "image",
                        "image": {
                            "link": active_media_url or self.fallback_image_url
                        }
                    }
                ]
            })
            components.append({
                "type": "BODY",
                "parameters": [
                    {
                        "type": "text",
                        "text": clean_user_name or "Learner"
                    }
                ]
            })
        elif tpl_name == "video_type_template":
            # Video template
            components.append({
                "type": "HEADER",
                "parameters": [
                    {
                        "type": "video",
                        "video": {
                            "link": active_media_url or self.fallback_media_url
                        }
                    }
                ]
            })
            components.append({
                "type": "BODY",
                "parameters": [
                    {
                        "type": "text",
                        "text": clean_user_name or "Learner"
                    }
                ]
            })
        else:
            # Generic custom template
            if active_media_url and active_media_type in ["image", "video", "document"]:
                components.append({
                    "type": "HEADER",
                    "parameters": [
                        {
                            "type": active_media_type,
                            active_media_type: {
                                "link": active_media_url
                            }
                        }
                    ]
                })
            components.append({
                "type": "BODY",
                "parameters": [
                    {
                        "type": "text",
                        "text": clean_message_body or clean_user_name or "Learner"
                    }
                ]
            })

        payload = {
            "template": {
                "components": components,
                "name": tpl_name,
                "language": {
                    "code": lang_code,
                    "policy": "deterministic"
                }
            },
            "to": to_phone,
            "type": "template",
            "templateName": tpl_name
        }

        headers = {
            "Key": self.api_key,
            "wabaNumber": self.waba_number,
            "content-type": "application/json"
        }

        try:
            logger.info(f"[DoveSoft WhatsApp] Sending to {to_phone} using template '{tpl_name}'")
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(self.api_url, json=payload, headers=headers)
                
                logger.info(f"[DoveSoft WhatsApp] HTTP {response.status_code} response: {response.text}")
                
                if response.status_code in [200, 201]:
                    resp_text = (response.text or "").strip()
                    try:
                        resp_data = response.json() if resp_text else {}
                    except Exception:
                        resp_data = {"raw": resp_text}
                    
                    # Check for explicit DoveSoft error list e.g. [{"errorDescription": "...", "errorCode": 1053}]
                    if isinstance(resp_data, list) and len(resp_data) > 0:
                        first_err = resp_data[0]
                        if isinstance(first_err, dict) and ("errorCode" in first_err or "errorDescription" in first_err):
                            desc = first_err.get("errorDescription") or "DoveSoft error"
                            code = first_err.get("errorCode", "")
                            error_detail = f"{desc} (errorCode: {code})" if code else desc
                            logger.error(f"[DoveSoft WhatsApp] Message rejected by DoveSoft/Meta: {error_detail}")
                            return {
                                "success": False,
                                "message_id": None,
                                "error": error_detail,
                                "response": resp_data
                            }

                    # Check for dict errors e.g. {"error": "..."}
                    if isinstance(resp_data, dict) and resp_data.get("error"):
                        error_detail = str(resp_data["error"])
                        logger.error(f"[DoveSoft WhatsApp] Message rejected by DoveSoft/Meta: {error_detail}")
                        return {
                            "success": False,
                            "message_id": None,
                            "error": error_detail,
                            "response": resp_data
                        }

                    # Extract real Meta message ID (wamid)
                    message_id = None
                    if isinstance(resp_data, dict):
                        messages = resp_data.get("messages")
                        if messages and isinstance(messages, list) and len(messages) > 0 and messages[0].get("id"):
                            message_id = messages[0]["id"]
                        elif resp_data.get("message_id") or resp_data.get("id"):
                            message_id = resp_data.get("message_id") or resp_data.get("id")

                    if message_id:
                        logger.info(f"[DoveSoft WhatsApp] Message successfully sent to {to_phone} (wamid: {message_id}) using template '{tpl_name}'")
                        return {
                            "success": True,
                            "message_id": message_id,
                            "response": resp_data,
                            "error": None
                        }

                    # If no message_id returned, DoveSoft did not deliver because template is unapproved on this WABA.
                    # Automatically fallback to the verified approved template 'lucid_video' so the user actually gets the message!
                    if tpl_name not in ["lucid_video", "whatsapp_lucid"]:
                        logger.warning(
                            f"[DoveSoft WhatsApp] Template '{tpl_name}' was not accepted by DoveSoft/Meta (empty response - template likely not approved on WABA {self.waba_number}). "
                            f"Falling back to verified template 'lucid_video' to guarantee delivery to {to_phone}..."
                        )
                        return await self.send_template_message(
                            recipient_phone=recipient_phone,
                            user_name=user_name,
                            message_body=message_body,
                            media_url=active_media_url or self.fallback_media_url,
                            media_type="video",
                            template_name="lucid_video",
                        )
                    else:
                        error_detail = f"DoveSoft returned empty response for {tpl_name}"
                        logger.error(f"[DoveSoft WhatsApp] {error_detail}")
                        return {
                            "success": False,
                            "message_id": None,
                            "error": error_detail,
                            "response": resp_data
                        }
                else:
                    return {
                        "success": False,
                        "message_id": None,
                        "error": f"DoveSoft API HTTP {response.status_code}: {response.text}"
                    }
        except Exception as e:
            logger.error(f"[DoveSoft WhatsApp] Failed to send message to {to_phone}: {e}")
            return {
                "success": False,
                "message_id": None,
                "error": str(e)
            }

    # ── Backward-compatible helper methods ────────────────────────────

    async def send_text_message(
        self,
        recipient_phone: str,
        message_body: str,
        user_name: str = "Learner",
        preview_url: bool = False,
    ) -> Dict[str, Any]:
        """
        Sends message using the approved template with default media header.
        """
        return await self.send_template_message(
            recipient_phone=recipient_phone,
            user_name=user_name,
            message_body=message_body,
            media_url=None,
            media_type=None,
        )

    async def send_image_message(
        self,
        recipient_phone: str,
        image_url: str,
        caption: Optional[str] = None,
        user_name: str = "Learner",
    ) -> Dict[str, Any]:
        """
        Sends message with image header.
        """
        return await self.send_template_message(
            recipient_phone=recipient_phone,
            user_name=user_name,
            message_body=caption or "Visual Learning Summary",
            media_url=image_url,
            media_type="image",
        )

    async def send_audio_message(
        self,
        recipient_phone: str,
        audio_url: str,
        user_name: str = "Learner",
        caption: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Sends message with audio media.
        """
        return await self.send_template_message(
            recipient_phone=recipient_phone,
            user_name=user_name,
            message_body=caption or "Audio Lesson Attached",
            media_url=audio_url,
            media_type="audio",
        )

    async def send_video_message(
        self,
        recipient_phone: str,
        video_url: str,
        caption: Optional[str] = None,
        user_name: str = "Learner",
    ) -> Dict[str, Any]:
        """
        Sends message with video media header.
        """
        return await self.send_template_message(
            recipient_phone=recipient_phone,
            user_name=user_name,
            message_body=caption or "Video Lesson",
            media_url=video_url,
            media_type="video",
        )

    async def send_document_message(
        self,
        recipient_phone: str,
        document_url: str,
        caption: Optional[str] = None,
        user_name: str = "Learner",
    ) -> Dict[str, Any]:
        """
        Sends message with document media header.
        """
        return await self.send_template_message(
            recipient_phone=recipient_phone,
            user_name=user_name,
            message_body=caption or "Document Attached",
            media_url=document_url,
            media_type="document",
        )


# Singleton instance
whatsapp_service = WhatsAppService()
