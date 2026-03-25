import asyncio
import logging
from datetime import datetime, date, time
from typing import Dict, Any, List, Optional
from utils.db.whatsapp_db import (
    get_pending_scheduled_messages,
    get_pending_dispatch_records,
    update_dispatch_status,
    update_dispatch_retry_count,
    get_dispatch_record_by_id,
    get_module_content,
)
from whatsapp.service import whatsapp_service
from whatsapp.formatter import formatter

logger = logging.getLogger(__name__)


class WhatsAppCronWorker:
    """
    Background worker that polls scheduled_whatsapp table and
    sends pending messages via WhatsApp Business API.
    """

    def __init__(self):
        self.service = whatsapp_service
        self.max_retries = 3
        self.is_running = False

    def is_due_today(self, scheduled_message: Dict[str, Any]) -> bool:
        """
        Check if a scheduled message should be sent today.
        
        For one_time: scheduled_date <= today
        For recurring: today's day of week is in days_of_week
        """
        today = date.today()
        schedule_type = scheduled_message.get("schedule_type")
        
        if schedule_type == "one_time":
            scheduled_date_str = scheduled_message.get("scheduled_date")
            if not scheduled_date_str:
                return False
            scheduled_date = datetime.fromisoformat(scheduled_date_str).date()
            return scheduled_date <= today
        
        elif schedule_type == "recurring":
            days_of_week = scheduled_message.get("days_of_week", [])
            if not days_of_week:
                return False
            today_dow = today.weekday()  # 0=Monday, 6=Sunday
            # Convert to ISO format: 0=Sunday, 1=Monday, ..., 6=Saturday
            iso_dow = (today_dow + 1) % 7
            return iso_dow in days_of_week
        
        return False

    def is_time_due(self, scheduled_time: str) -> bool:
        """
        Check if it's time to send (scheduled_time is in HH:MM format).
        Returns True if current time >= scheduled_time.
        """
        try:
            sched_time = datetime.strptime(scheduled_time, "%H:%M").time()
            current_time = datetime.utcnow().time()
            # Send if current time is within 5 minutes before or after scheduled time
            # (to account for cron job frequency)
            return current_time >= sched_time
        except ValueError:
            logger.error(f"Invalid time format: {scheduled_time}")
            return False

    async def process_pending_messages(self):
        """
        Main cron job: fetch pending messages and send them.
        """
        try:
            logger.info("🔄 WhatsApp Cron: Starting message processing...")
            
            # Get all active scheduled messages
            result = await get_pending_scheduled_messages()
            if result["error"]:
                logger.error(f"❌ Error fetching scheduled messages: {result['error']}")
                return
            
            scheduled_messages = result.get("data", [])
            logger.info(f"📋 Found {len(scheduled_messages)} scheduled messages")
            
            for scheduled_msg in scheduled_messages:
                scheduled_whatsapp_id = scheduled_msg.get("scheduled_whatsapp_id")
                
                # Check if this message is due
                if not self.is_due_today(scheduled_msg):
                    continue
                
                if not self.is_time_due(scheduled_msg.get("scheduled_time", "00:00")):
                    logger.debug(f"⏰ Message {scheduled_whatsapp_id} not due yet")
                    continue
                
                logger.info(f"📤 Processing scheduled message: {scheduled_whatsapp_id}")
                await self.send_scheduled_message(scheduled_msg)
        
        except Exception as e:
            logger.error(f"❌ Error in WhatsApp cron worker: {str(e)}", exc_info=True)

    async def send_scheduled_message(self, scheduled_msg: Dict[str, Any]):
        """
        Send a scheduled message to all pending dispatch records.
        """
        scheduled_whatsapp_id = scheduled_msg.get("scheduled_whatsapp_id")
        
        try:
            # Get all pending dispatch records for this schedule
            dispatch_result = await get_pending_dispatch_records(
                scheduled_whatsapp_id, status="pending"
            )
            if dispatch_result["error"]:
                logger.error(
                    f"❌ Error fetching dispatch records: {dispatch_result['error']}"
                )
                return
            
            dispatch_records = dispatch_result.get("data", [])
            logger.info(f"📨 Sending to {len(dispatch_records)} recipients")
            
            # Process each dispatch record
            for dispatch in dispatch_records:
                await self.send_to_user(dispatch, scheduled_msg)
        
        except Exception as e:
            logger.error(f"❌ Error sending scheduled message: {str(e)}")

    async def send_to_user(
        self,
        dispatch: Dict[str, Any],
        scheduled_msg: Dict[str, Any],
    ):
        """
        Send a message to a single user via WhatsApp.
        """
        dispatch_id = dispatch.get("whatsapp_dispatch_id")
        user_id = dispatch.get("user_id")
        phone_number = dispatch.get("phone_number")
        
        try:
            logger.info(f"📞 Sending to {phone_number} (user: {user_id})")
            
            # Build message content
            message_body = scheduled_msg.get("message_body", "")
            media_url = scheduled_msg.get("media_url")
            media_type = scheduled_msg.get("media_type")
            
            # Send based on media type
            result = None
            if media_type == "image":
                result = await self.service.send_image_message(
                    phone_number, media_url, message_body
                )
            elif media_type == "audio":
                result = await self.service.send_audio_message(phone_number, media_url)
            elif media_type == "video":
                result = await self.service.send_video_message(
                    phone_number, media_url, message_body
                )
            elif media_type == "document":
                result = await self.service.send_document_message(
                    phone_number, media_url, message_body
                )
            else:
                # Default to text message
                result = await self.service.send_text_message(phone_number, message_body)
            
            # Update dispatch status
            if result.get("success"):
                await update_dispatch_status(
                    dispatch_id,
                    "sent",
                    whatsapp_message_id=result.get("message_id"),
                )
                logger.info(f"✅ Message sent to {phone_number}")
            else:
                error_msg = result.get("error", "Unknown error")
                retry_count = dispatch.get("retry_count", 0)
                max_retries = dispatch.get("max_retries", 3)
                
                if retry_count < max_retries:
                    await update_dispatch_retry_count(dispatch_id)
                    logger.warning(
                        f"⚠️ Failed (attempt {retry_count + 1}): {error_msg}"
                    )
                else:
                    await update_dispatch_status(
                        dispatch_id, "failed", error_message=error_msg
                    )
                    logger.error(f"❌ Failed permanently: {error_msg}")
        
        except Exception as e:
            logger.error(f"❌ Exception sending to {phone_number}: {str(e)}")
            await update_dispatch_status(
                dispatch_id, "failed", error_message=str(e)
            )


# Global worker instance
whatsapp_cron_worker = WhatsAppCronWorker()


async def run_whatsapp_cron():
    """
    Entry point for the WhatsApp cron job.
    This should be called every 5-10 minutes.
    """
    await whatsapp_cron_worker.process_pending_messages()

