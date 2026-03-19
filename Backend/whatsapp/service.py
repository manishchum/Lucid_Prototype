import os
import httpx
import json
from typing import Dict, Any, List, Optional
from datetime import datetime
from config import (
    WHATSAPP_BUSINESS_ACCOUNT_ID,
    WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_API_TOKEN,
    WHATSAPP_API_VERSION,
)


class WhatsAppService:
    """
    Service for interacting with Meta's WhatsApp Business API.
    """

    def __init__(self):
        self.api_version = WHATSAPP_API_VERSION
        self.phone_number_id = WHATSAPP_PHONE_NUMBER_ID
        self.api_token = WHATSAPP_API_TOKEN
        self.base_url = f"https://graph.instagram.com/{self.api_version}"

    async def send_text_message(
        self,
        recipient_phone: str,
        message_body: str,
        preview_url: bool = False,
    ) -> Dict[str, Any]:
        """
        Send a text message via WhatsApp.
        
        Args:
            recipient_phone: Phone number in E.164 format (e.g., "+1234567890")
            message_body: Text content
            preview_url: Whether to show link preview
        
        Returns:
            {
                "success": True/False,
                "message_id": "...",
                "error": None or error message
            }
        """
        try:
            endpoint = f"{self.base_url}/{self.phone_number_id}/messages"
            headers = {
                "Authorization": f"Bearer {self.api_token}",
                "Content-Type": "application/json",
            }
            
            payload = {
                "messaging_product": "whatsapp",
                "to": recipient_phone,
                "type": "text",
                "text": {
                    "preview_url": preview_url,
                    "body": message_body,
                },
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(endpoint, json=payload, headers=headers)
                
                if response.status_code in [200, 201]:
                    data = response.json()
                    message_id = data.get("messages", [{}])[0].get("id", "")
                    return {
                        "success": True,
                        "message_id": message_id,
                        "error": None,
                    }
                else:
                    error_data = response.json()
                    error_msg = error_data.get("error", {}).get("message", response.text)
                    return {
                        "success": False,
                        "message_id": None,
                        "error": error_msg,
                    }
        except Exception as e:
            return {
                "success": False,
                "message_id": None,
                "error": str(e),
            }

    async def send_image_message(
        self,
        recipient_phone: str,
        image_url: str,
        caption: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send an image message via WhatsApp.
        """
        try:
            endpoint = f"{self.base_url}/{self.phone_number_id}/messages"
            headers = {
                "Authorization": f"Bearer {self.api_token}",
                "Content-Type": "application/json",
            }
            
            image_payload = {"link": image_url}
            if caption:
                image_payload["caption"] = caption
            
            payload = {
                "messaging_product": "whatsapp",
                "to": recipient_phone,
                "type": "image",
                "image": image_payload,
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(endpoint, json=payload, headers=headers)
                
                if response.status_code in [200, 201]:
                    data = response.json()
                    message_id = data.get("messages", [{}])[0].get("id", "")
                    return {
                        "success": True,
                        "message_id": message_id,
                        "error": None,
                    }
                else:
                    error_data = response.json()
                    error_msg = error_data.get("error", {}).get("message", response.text)
                    return {
                        "success": False,
                        "message_id": None,
                        "error": error_msg,
                    }
        except Exception as e:
            return {
                "success": False,
                "message_id": None,
                "error": str(e),
            }

    async def send_audio_message(
        self,
        recipient_phone: str,
        audio_url: str,
    ) -> Dict[str, Any]:
        """
        Send an audio message via WhatsApp.
        """
        try:
            endpoint = f"{self.base_url}/{self.phone_number_id}/messages"
            headers = {
                "Authorization": f"Bearer {self.api_token}",
                "Content-Type": "application/json",
            }
            
            payload = {
                "messaging_product": "whatsapp",
                "to": recipient_phone,
                "type": "audio",
                "audio": {
                    "link": audio_url,
                },
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(endpoint, json=payload, headers=headers)
                
                if response.status_code in [200, 201]:
                    data = response.json()
                    message_id = data.get("messages", [{}])[0].get("id", "")
                    return {
                        "success": True,
                        "message_id": message_id,
                        "error": None,
                    }
                else:
                    error_data = response.json()
                    error_msg = error_data.get("error", {}).get("message", response.text)
                    return {
                        "success": False,
                        "message_id": None,
                        "error": error_msg,
                    }
        except Exception as e:
            return {
                "success": False,
                "message_id": None,
                "error": str(e),
            }

    async def send_video_message(
        self,
        recipient_phone: str,
        video_url: str,
        caption: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send a video message via WhatsApp.
        """
        try:
            endpoint = f"{self.base_url}/{self.phone_number_id}/messages"
            headers = {
                "Authorization": f"Bearer {self.api_token}",
                "Content-Type": "application/json",
            }
            
            video_payload = {"link": video_url}
            if caption:
                video_payload["caption"] = caption
            
            payload = {
                "messaging_product": "whatsapp",
                "to": recipient_phone,
                "type": "video",
                "video": video_payload,
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(endpoint, json=payload, headers=headers)
                
                if response.status_code in [200, 201]:
                    data = response.json()
                    message_id = data.get("messages", [{}])[0].get("id", "")
                    return {
                        "success": True,
                        "message_id": message_id,
                        "error": None,
                    }
                else:
                    error_data = response.json()
                    error_msg = error_data.get("error", {}).get("message", response.text)
                    return {
                        "success": False,
                        "message_id": None,
                        "error": error_msg,
                    }
        except Exception as e:
            return {
                "success": False,
                "message_id": None,
                "error": str(e),
            }

    async def send_document_message(
        self,
        recipient_phone: str,
        document_url: str,
        caption: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send a document message via WhatsApp.
        """
        try:
            endpoint = f"{self.base_url}/{self.phone_number_id}/messages"
            headers = {
                "Authorization": f"Bearer {self.api_token}",
                "Content-Type": "application/json",
            }
            
            doc_payload = {"link": document_url}
            if caption:
                doc_payload["caption"] = caption
            
            payload = {
                "messaging_product": "whatsapp",
                "to": recipient_phone,
                "type": "document",
                "document": doc_payload,
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(endpoint, json=payload, headers=headers)
                
                if response.status_code in [200, 201]:
                    data = response.json()
                    message_id = data.get("messages", [{}])[0].get("id", "")
                    return {
                        "success": True,
                        "message_id": message_id,
                        "error": None,
                    }
                else:
                    error_data = response.json()
                    error_msg = error_data.get("error", {}).get("message", response.text)
                    return {
                        "success": False,
                        "message_id": None,
                        "error": error_msg,
                    }
        except Exception as e:
            return {
                "success": False,
                "message_id": None,
                "error": str(e),
            }

    async def send_message_by_content_type(
        self,
        recipient_phone: str,
        content_type: str,
        content_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Send message based on content type.
        
        content_type: 'flashcards', 'audio', 'video', 'mindmap', 'infographic'
        content_data: Dict with relevant fields
        """
        if content_type == "flashcards":
            message_body = self._format_flashcards_message(content_data)
            return await self.send_text_message(recipient_phone, message_body)
        
        elif content_type == "audio":
            audio_url = content_data.get("audio_url", "")
            if not audio_url:
                return {"success": False, "message_id": None, "error": "No audio URL provided"}
            return await self.send_audio_message(recipient_phone, audio_url)
        
        elif content_type == "video":
            video_url = content_data.get("video_url", "")
            if not video_url:
                return {"success": False, "message_id": None, "error": "No video URL provided"}
            caption = f"📹 {content_data.get('title', 'Video Lesson')}"
            return await self.send_video_message(recipient_phone, video_url, caption)
        
        elif content_type == "mindmap":
            mindmap_url = content_data.get("mindmap_image_url", "")
            if not mindmap_url:
                return {"success": False, "message_id": None, "error": "No mindmap URL provided"}
            caption = f"🗺️ {content_data.get('title', 'Mind Map')}"
            return await self.send_image_message(recipient_phone, mindmap_url, caption)
        
        elif content_type == "infographic":
            infographic_url = content_data.get("infographic_image_url", "")
            if not infographic_url:
                return {"success": False, "message_id": None, "error": "No infographic URL provided"}
            caption = f"📊 {content_data.get('title', 'Infographic')}"
            return await self.send_image_message(recipient_phone, infographic_url, caption)
        
        else:
            return {"success": False, "message_id": None, "error": f"Unknown content type: {content_type}"}

    @staticmethod
    def _format_flashcards_message(content_data: Dict[str, Any]) -> str:
        """
        Format flashcard data into a WhatsApp text message.
        """
        title = content_data.get("title", "Learning Module")
        flashcards = content_data.get("flashcard_data", [])
        
        message = f"📚 {title}\n\n"
        
        if flashcards:
            for i, card in enumerate(flashcards, 1):
                heading = card.get("heading", f"Flashcard {i}")
                points = card.get("points", [])
                
                message += f"*{heading}*\n"
                for point in points:
                    message += f"• {point}\n"
                message += "\n"
        else:
            message += "No flashcards available.\n"
        
        message += f"\n✨ Visit the course to learn more!"
        
        return message


# Singleton instance
whatsapp_service = WhatsAppService()
