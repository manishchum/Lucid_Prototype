from typing import Dict, Any, List, Optional


class WhatsAppMessageFormatter:
    """
    Format content into WhatsApp-friendly messages.
    """

    @staticmethod
    def format_flashcards(
        title: str,
        flashcard_data: List[Dict[str, Any]],
        module_title: str = "Learning Module",
    ) -> str:
        """
        Format flashcard data into a WhatsApp text message.
        
        Args:
            title: Content block title
            flashcard_data: List of flashcard objects with 'heading' and 'points'
            module_title: Overall module name
        
        Returns:
            Formatted message string
        """
        message = f"📚 {module_title}\n\n"
        message += f"*{title}*\n\n"
        
        if not flashcard_data:
            message += "No flashcards available.\n"
            return message
        
        for i, card in enumerate(flashcard_data, 1):
            heading = card.get("heading", f"Card {i}")
            points = card.get("points", [])
            
            message += f"*{heading}*\n"
            for point in points:
                message += f"• {point}\n"
            message += "\n"
        
        message += "✨ Continue learning on the platform!"
        return message

    @staticmethod
    def format_audio_message(
        module_title: str,
        title: str,
        duration_minutes: Optional[int] = None,
    ) -> str:
        """
        Format audio lesson introduction message.
        
        Args:
            module_title: Overall module name
            title: Audio lesson title
            duration_minutes: Duration of audio in minutes
        
        Returns:
            Formatted message string
        """
        message = f"🎧 Audio Lesson\n\n"
        message += f"*Module:* {module_title}\n"
        message += f"*Lesson:* {title}\n"
        
        if duration_minutes:
            message += f"*Duration:* {duration_minutes} minutes\n"
        
        message += "\n📌 The audio file is attached. You can play it directly here or download it.\n"
        message += "✨ Don't forget to review the key points after listening!"
        
        return message

    @staticmethod
    def format_video_message(
        module_title: str,
        title: str,
    ) -> str:
        """
        Format video lesson introduction message.
        """
        message = f"🎬 Video Lesson\n\n"
        message += f"*Module:* {module_title}\n"
        message += f"*Title:* {title}\n\n"
        message += "📌 Watch the video below. You can stream it or download it for offline viewing.\n"
        message += "✨ Take notes and test your knowledge after watching!"
        
        return message

    @staticmethod
    def format_mindmap_message(
        module_title: str,
        title: str,
    ) -> str:
        """
        Format mindmap message.
        """
        message = f"🗺️ Mind Map\n\n"
        message += f"*Module:* {module_title}\n"
        message += f"*Topic:* {title}\n\n"
        message += "📌 Here's a visual breakdown of the key concepts and how they connect.\n"
        message += "✨ Use this as a reference for your studies!"
        
        return message

    @staticmethod
    def format_infographic_message(
        module_title: str,
        title: str,
    ) -> str:
        """
        Format infographic message.
        """
        message = f"📊 Infographic\n\n"
        message += f"*Module:* {module_title}\n"
        message += f"*Topic:* {title}\n\n"
        message += "📌 Visual summary of important facts and figures.\n"
        message += "✨ Share this with your team!"
        
        return message

    @staticmethod
    def format_engagement_question(
        question: str,
        context: str = "",
    ) -> str:
        """
        Format an engagement question as a follow-up message.
        """
        message = "❓ *Daily Challenge*\n\n"
        message += f"{question}\n"
        
        if context:
            message += f"\n_Context: {context}_\n"
        
        message += "\n💬 Share your answer in the replies below!"
        
        return message

    @staticmethod
    def format_scheduled_notification(
        module_title: str,
        content_type: str,
        scheduled_time: str = None,
        next_content: str = None,
    ) -> str:
        """
        Format a notification about upcoming content.
        
        Args:
            module_title: Module name
            content_type: Type of content (flashcards, audio, video, etc.)
            scheduled_time: When the content will be sent
            next_content: What will be sent next
        
        Returns:
            Formatted notification string
        """
        emoji_map = {
            "flashcards": "🃏",
            "audio": "🎧",
            "video": "🎬",
            "mindmap": "🗺️",
            "infographic": "📊",
        }
        
        emoji = emoji_map.get(content_type.lower(), "📌")
        
        message = f"🔔 *Upcoming Content*\n\n"
        message += f"You'll receive {emoji} *{content_type.capitalize()}* for\n"
        message += f"*{module_title}*\n"
        
        if scheduled_time:
            message += f"\n⏰ Scheduled for: {scheduled_time}\n"
        
        if next_content:
            message += f"\n📋 What's next: {next_content}\n"
        
        message += "\n✨ Stay tuned!"
        
        return message


# Singleton instance
formatter = WhatsAppMessageFormatter()

