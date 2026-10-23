import os
import httpx
import logging
from typing import Dict, Any, List, Optional
from config import (
    DOVESOFT_WHATSAPP_URL,
    DOVESOFT_WABA_NUMBER,
    DOVESOFT_API_KEY,
    DOVESOFT_WHATSAPP_DEFAULT_TEMPLATE,
)

logger = logging.getLogger("lucid.whatsapp_service")


class WhatsAppService:
    """
    Service for sending WhatsApp messages via DoveSoft REST Direct API.
    Uses approved Meta/DoveSoft templates (e.g. 'whatsapp_lucid').
    """

    def __init__(self):
        self.api_url = DOVESOFT_WHATSAPP_URL or "https://api.dovesoft.io/REST/directApi/message"
        self.waba_number = DOVESOFT_WABA_NUMBER or "918448555602"
        self.api_key = DOVESOFT_API_KEY or ""
        self.default_template = DOVESOFT_WHATSAPP_DEFAULT_TEMPLATE or "whatsapp_lucid"
        self.fallback_media_url = "https://rest.dovesoft.io//tempMediaFiles/testVideo.mp4"

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
            template_name: Approved template name (defaults to 'whatsapp_lucid')
        """
        to_phone = self.normalize_phone_number(recipient_phone)
        if not to_phone:
            return {
                "success": False,
                "message_id": None,
                "error": "Recipient phone number is missing or invalid.",
            }

        tpl_name = template_name or self.default_template

        # Normalize media parameters for HEADER
        active_media_url = media_url or self.fallback_media_url
        active_media_type = (media_type or "video").lower()
        if active_media_type not in ["video", "image", "audio", "document"]:
            active_media_type = "video"

        components = [
            {
                "type": "HEADER",
                "parameters": [
                    {
                        "type": active_media_type,
                        active_media_type: {
                            "link": active_media_url
                        }
                    }
                ]
            },
            {
                "type": "BODY",
                "parameters": [
                    {
                        "type": "text",
                        "text": user_name or "Learner"
                    },
                    {
                        "type": "text",
                        "text": message_body or "You have a new training update."
                    }
                ]
            }
        ]

        payload = {
            "template": {
                "components": components,
                "name": tpl_name,
                "language": {
                    "code": "en",
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
                    try:
                        resp_data = response.json()
                    except Exception:
                        resp_data = {"raw": response.text}
                    
                    # Extract message id if available in response
                    message_id = (
                        resp_data.get("messages", [{}])[0].get("id")
                        or resp_data.get("message_id")
                        or resp_data.get("id")
                        or "dovesoft_dispatched"
                    )
                    return {
                        "success": True,
                        "message_id": message_id,
                        "response": resp_data,
                        "error": None
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
            media_url=self.fallback_media_url,
            media_type="video",
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
