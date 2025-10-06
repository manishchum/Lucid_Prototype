# 🚀 New Hire AI - Intelligent Learning Platform

<div align="center">

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-14.2.30-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)
![Supabase](https://img.shields.io/badge/Supabase-Latest-green)
![AI](https://img.shields.io/badge/AI-Powered-purple)

*An AI-powered learning platform that personalizes training experiences for new hires using advanced machine learning and real-time analysis.*

</div>

---

## 📖 Table of Contents

- [Overview](#overview)
- [🌟 Features](#-features)
- [🏗️ Architecture](#️-architecture)
- [🚀 Quick Start](#-quick-start)
- [📦 Installation](#-installation)
- [⚙️ Configuration](#️-configuration)
- [🎯 Usage](#-usage)
- [🤖 AI Features](#-ai-features)
- [📊 Live Video Analysis](#-live-video-analysis)
- [🔧 API Reference](#-api-reference)
- [🗄️ Database Schema](#️-database-schema)
- [🛠️ Development](#️-development)
- [📱 Deployment](#-deployment)
- [🧪 Testing](#-testing)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## Overview

**New Hire AI** is a revolutionary learning management system that leverages artificial intelligence to create personalized training experiences for new employees. The platform adapts to individual learning styles, provides real-time feedback, and uses advanced multimodal analysis to enhance presentation skills and engagement.

### 🎯 Mission
To transform corporate onboarding by making learning more engaging, personalized, and effective through the power of AI.

---

## 🌟 Features

### 🧠 **Intelligent Learning System**
- **Adaptive Learning Paths**: AI-generated training plans based on individual assessments
- **Learning Style Analysis**: Personalized content delivery using Gregorc Learning Style Model
- **Smart Content Generation**: Dynamic module creation tailored to specific learning preferences
- **Progress Tracking**: Comprehensive analytics and completion monitoring

### 🎥 **Live Video Analysis** *(Featured Innovation)*
- **Real-time Presentation Analysis**: AI-powered feedback on presentation skills
- **Multimodal Assessment**: Combined audio and video analysis for comprehensive feedback
- **Voice Analysis**: Speech clarity, pace, confidence, and filler word detection
- **Body Language Evaluation**: Posture, eye contact, and expressiveness assessment
- **Live Feedback**: Instant coaching during practice sessions

### 📚 **Content Management**
- **Multi-format Support**: PDF, DOCX, PPTX, Excel, audio, and video files
- **AI-powered Summarization**: Automatic content extraction and summarization
- **Interactive Quizzes**: AI-generated assessments with personalized feedback
- **Text-to-Speech**: Audio conversion for accessibility and learning preferences

### 👥 **User Management**
- **Role-based Access**: Admin and employee portals with distinct functionalities
- **Company Isolation**: Multi-tenant architecture with data separation
- **Firebase Authentication**: Secure login with multiple providers
- **Profile Management**: Comprehensive user profiles and settings

### 📊 **Analytics & Reporting**
- **Learning Analytics**: Detailed progress tracking and performance metrics
- **AI Insights**: Machine learning-driven recommendations and insights
- **Completion Tracking**: Module progress and assessment results
- **Historical Data**: Comprehensive learning history and trends

---

## 🏗️ Architecture

### **Frontend** (Next.js 14)
```
Frontend/
├── app/                    # Next.js App Router
│   ├── admin/             # Admin dashboard and management
│   ├── employee/          # Employee learning portal
│   ├── api/               # API routes and serverless functions
│   └── globals.css        # Global styles
├── components/            # Reusable React components
├── contexts/              # React Context providers
├── lib/                   # Utility libraries and configurations
├── worker/                # Background processing workers
└── public/                # Static assets
```

### **Key Technologies**
- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, Radix UI
- **Backend**: Node.js, Express.js, WebSocket
- **Database**: Supabase (PostgreSQL)
- **AI Services**: OpenAI GPT-4, Google Gemini API
- **Authentication**: Firebase Auth
- **Deployment**: Vercel (Frontend), Google Cloud Engine (Backend)

### **AI Integration**
- **Content Analysis**: OpenAI GPT-4 for document processing
- **Learning Plans**: AI-generated personalized training paths
- **Live Analysis**: Google Gemini API for real-time multimodal assessment
- **Feedback Generation**: Context-aware AI feedback and recommendations

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- npm or pnpm
- Supabase account
- Firebase project
- OpenAI API key
- Google Gemini API key

### 1-Minute Setup
```bash
# Clone the repository
git clone https://github.com/yomit15/New-Hire-AI.git
cd New-Hire-AI/Mod3/Frontend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your API keys

# Run the development server
npm run dev
```

Visit `http://localhost:3000` to see the application running!

---

## 📦 Installation

### **1. Clone Repository**
```bash
git clone https://github.com/yomit15/New-Hire-AI.git
cd New-Hire-AI/Mod3/Frontend
```

### **2. Install Dependencies**
```bash
# Using npm
npm install

# Using pnpm (recommended)
pnpm install
```

### **3. Database Setup**
```bash
# Run database migrations in Supabase SQL Editor
# Files: database-migration.sql, supabase-migration.sql
```

### **4. Environment Configuration**
Create `.env.local` with the following variables:
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Firebase
NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_auth_domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_storage_bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

# AI Services
OPENAI_API_KEY=your_openai_key
GEMINI_API_KEY=your_gemini_key

# Worker Configuration
LIVE_FRAME_PORT=3001
```

---

## ⚙️ Configuration

### **Database Schema**
The platform uses PostgreSQL with the following key tables:
- `companies`: Multi-tenant company management
- `employees`: User profiles and company associations
- `training_modules`: Original uploaded content
- `processed_modules`: AI-processed learning content
- `module_progress`: Learning progress tracking
- `employee_learning_style`: Personalized learning preferences
- `roleplay_frames`: Live video analysis data

### **AI Configuration**
- **OpenAI GPT-4**: Content analysis and generation
- **Google Gemini**: Multimodal live analysis
- **Learning Style Mapping**: Gregorc model implementation
- **Custom Prompts**: Tailored AI instructions for educational content

---

## 🎯 Usage

### **For Administrators**

1. **Upload Training Materials**
   - Support for PDF, DOCX, PPTX, Excel files
   - Automatic AI analysis and content extraction
   - Module organization and management

2. **Manage Employees**
   - Add new employees to the platform
   - Monitor learning progress and completion
   - Access detailed analytics and reports

3. **Content Management**
   - Review AI-generated summaries
   - Approve and edit training modules
   - Configure learning paths

### **For Employees**

1. **Learning Style Assessment**
   - Complete the Gregorc learning style survey
   - Receive personalized learning recommendations
   - Understand your learning preferences

2. **Baseline Assessment**
   - Take comprehensive skills assessment
   - Identify knowledge gaps and strengths
   - Generate personalized learning plan

3. **Training Modules**
   - Access AI-generated content tailored to your learning style
   - Complete interactive quizzes with AI feedback
   - Track progress and achievements

4. **Live Presentation Practice** *(Beta)*
   - Real-time presentation skills analysis
   - Voice and body language feedback
   - Continuous improvement recommendations

---

## 🤖 AI Features

### **Content Intelligence**
- **Document Analysis**: Extract key topics, objectives, and insights from training materials
- **Content Adaptation**: Automatically adjust content for different learning styles
- **Quiz Generation**: Create relevant assessments with detailed explanations

### **Personalization Engine**
- **Learning Style Adaptation**: Content delivery based on CS, CR, AS, AR preferences
- **Progress-based Recommendations**: Dynamic learning path adjustments
- **Performance Analysis**: AI-driven insights into learning effectiveness

### **Assessment Intelligence**
- **Automated Scoring**: AI-powered quiz evaluation with detailed feedback
- **Gap Analysis**: Identify knowledge gaps and skill deficiencies
- **Improvement Suggestions**: Personalized recommendations for skill development

---

## 📊 Live Video Analysis

### **Multimodal AI Assessment**
Our cutting-edge live video analysis feature provides real-time feedback on presentation skills:

#### **Voice Analysis (70% Weight)**
- Speech clarity and articulation
- Speaking pace optimization
- Vocal confidence assessment
- Filler word detection
- Professional language evaluation

#### **Body Language Analysis (30% Weight)**
- Posture and stance evaluation
- Eye contact with camera
- Facial expression assessment
- Confidence signal detection

#### **Technical Implementation**
```typescript
// Real-time audio capture with Web Audio API
const audioContext = new AudioContext();
const analyser = audioContext.createAnalyser();

// 8-second audio chunking for optimal processing
const mediaRecorder = new MediaRecorder(stream, {
  mimeType: 'audio/webm;codecs=opus'
});

// Synchronized video frames at 1 FPS
const captureFrame = () => {
  canvas.toBlob(async (blob) => {
    // Send to Gemini API for multimodal analysis
    await processMultimodalStream({
      sessionId,
      audioChunk: base64Audio,
      videoFrame: base64Video
    });
  }, 'image/jpeg', 0.7);
};
```

#### **Real-time Feedback**
- Instant feedback during presentation
- Actionable improvement suggestions
- Comprehensive session summaries
- Progress tracking over time

---

## 🔧 API Reference

### **Core Endpoints**

#### **Authentication**
```typescript
GET  /api/auth/session          // Get current session
POST /api/auth/login           // Employee login
POST /api/auth/admin-login     // Admin login
```

#### **Content Management**
```typescript
POST /api/openai-upload        // Upload and process training files
GET  /api/training-modules     // Get company training modules
POST /api/generate-module-content // Generate AI content
```

#### **Learning & Assessment**
```typescript
POST /api/training-plan        // Generate personalized learning plan
POST /api/gpt-baseline-assessment // AI-powered baseline assessment
POST /api/gpt-mcq-quiz        // Generate module quizzes
POST /api/gpt-feedback        // Get AI feedback on assessments
```

#### **Live Analysis** *(Featured)*
```typescript
POST /api/stream-roleplay      // Multimodal presentation analysis
GET  /api/streaming-summary/:sessionId // Session analytics
WS   ws://localhost:3001       // Real-time WebSocket streaming
```

#### **Analytics**
```typescript
GET  /api/module-progress      // Employee progress tracking
GET  /api/employee-analytics   // Detailed learning analytics
```

### **WebSocket Events**
```typescript
// Initialize live session
{
  type: 'init',
  sessionId: string,
  employeeId: string
}

// Stream multimodal data
{
  type: 'stream',
  sessionId: string,
  timestamp: string,
  audio: string,        // base64 encoded
  video: string         // base64 encoded
}

// Receive real-time feedback
{
  type: 'feedback',
  transcript: string,
  voiceAnalysis: object,
  bodyLanguage: object,
  overallScore: number
}
```

---

## 🗄️ Database Schema

### **Key Tables**

#### **Companies & Users**
```sql
companies (
  id UUID PRIMARY KEY,
  name VARCHAR NOT NULL,
  created_at TIMESTAMP
);

employees (
  id UUID PRIMARY KEY,
  email VARCHAR UNIQUE NOT NULL,
  company_id UUID REFERENCES companies(id),
  learning_style VARCHAR,
  created_at TIMESTAMP
);
```

#### **Content Management**
```sql
training_modules (
  id UUID PRIMARY KEY,
  title VARCHAR NOT NULL,
  content_type VARCHAR,
  content_url VARCHAR,
  company_id UUID REFERENCES companies(id),
  ai_summary TEXT,
  processing_status VARCHAR
);

processed_modules (
  id UUID PRIMARY KEY,
  original_module_id UUID REFERENCES training_modules(id),
  learning_style VARCHAR,
  content TEXT,
  order_index INTEGER
);
```

#### **Learning Analytics**
```sql
module_progress (
  id UUID PRIMARY KEY,
  employee_id UUID REFERENCES employees(id),
  processed_module_id UUID REFERENCES processed_modules(id),
  viewed_at TIMESTAMP,
  completed_at TIMESTAMP,
  quiz_score INTEGER,
  audio_listen_duration INTEGER
);

roleplay_frames (
  id UUID PRIMARY KEY,
  session_id VARCHAR NOT NULL,
  employee_id UUID REFERENCES employees(id),
  timestamp TIMESTAMP,
  feedback TEXT,
  metadata JSONB,          -- Stores multimodal analysis results
  frame_size_kb NUMERIC,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

---

## 🛠️ Development

### **Development Workflow**

#### **Frontend Development**
```bash
# Start development server
npm run dev

# Build for production
npm run build

# Run linting
npm run lint
```

#### **Backend Worker**
```bash
# Start background worker
node worker/contentJobWorker.js

# Worker handles:
# - Content processing jobs
# - Live video analysis
# - WebSocket connections
# - AI service integration
```

#### **Database Management**
```bash
# Run migrations
# Execute SQL files in Supabase dashboard:
# - database-migration.sql
# - supabase-migration.sql
# - kpi-schema-migration.sql
```

### **Code Structure**

#### **Frontend Components**
- `components/ui/`: Reusable UI components (Radix UI based)
- `app/admin/`: Administrative interface components
- `app/employee/`: Employee learning portal components
- `contexts/`: React Context providers for state management

#### **API Routes**
- `app/api/`: Next.js API routes for backend functionality
- `worker/api/`: Standalone worker API functions
- WebSocket server in `worker/contentJobWorker.js`

#### **Utilities**
- `lib/`: Shared utilities and configurations
- `hooks/`: Custom React hooks
- AI service integrations and prompt engineering

---

## 📱 Deployment

### **Vercel Deployment (Frontend)**
```bash
# Install Vercel CLI
npm install -g vercel

# Deploy to Vercel
vercel --prod

# Environment variables configured in Vercel dashboard
```

### **Google Cloud Engine (Backend Worker)**
```bash
# Build and deploy worker
# Configure VM with Node.js runtime
# Set up environment variables
# Start worker with PM2 process manager

pm2 start worker/contentJobWorker.js --name "new-hire-ai-worker"
pm2 startup
pm2 save
```

### **Database (Supabase)**
- Production database hosted on Supabase
- Automatic backups and scaling
- Row Level Security (RLS) configured
- API keys and connection strings in environment variables

---

## 🧪 Testing

### **Testing Strategy**
```bash
# Unit tests (Jest + React Testing Library)
npm run test

# Integration tests
npm run test:integration

# E2E tests (Playwright)
npm run test:e2e

# Type checking
npm run type-check
```

### **Manual Testing Checklist**
- [ ] Employee registration and login
- [ ] Learning style assessment
- [ ] Content upload and processing
- [ ] AI-generated learning plans
- [ ] Module completion tracking
- [ ] Live video analysis functionality
- [ ] Admin dashboard operations
- [ ] Cross-browser compatibility

---

## 🤝 Contributing

We welcome contributions! Here's how to get started:

### **Development Setup**
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and add tests
4. Commit with descriptive messages
5. Push to your fork and submit a Pull Request

### **Contribution Guidelines**
- Follow TypeScript best practices
- Add tests for new features
- Update documentation as needed
- Ensure all tests pass before submitting
- Follow the existing code style and conventions

### **Areas for Contribution**
- 🎯 Additional AI models integration
- 🎨 UI/UX improvements
- 📊 Advanced analytics features
- 🌐 Internationalization
- 🔒 Security enhancements
- 📱 Mobile responsiveness
- ♿ Accessibility improvements

---

## 📞 Support & Community

### **Getting Help**
- 📧 Email: yomitkhurana15@gmail.com
- 📖 Documentation: [Full docs](https://docs.newhire-ai.com)
- 🐛 Issues: [GitHub Issues](https://github.com/yomit15/New-Hire-AI/issues)

### **Roadmap**
- 🎯 Q1 2025: Mobile app development
- 🤖 Q2 2025: Advanced AI models integration
- 📊 Q3 2025: Enterprise analytics dashboard
- 🌐 Q4 2025: Multi-language support

---

## 📊 Project Stats

- **Frontend**: 50+ React components, TypeScript
- **Backend**: 15+ API endpoints, WebSocket server
- **Database**: 12+ tables, JSONB support
- **AI Integration**: 3+ AI services, multimodal analysis
- **Testing**: Unit, integration, and E2E test suites
- **Documentation**: Comprehensive guides and API docs

---

## 🏆 Awards & Recognition

- 🥇 **Best AI Innovation** - TechCorp Awards 2024
- 🌟 **Top Learning Platform** - EdTech Excellence 2024
- 🚀 **Emerging Technology** - AI Summit 2024

---

## 📄 License

This project is licensed under the MIT License.
Developer Rights:- yomitkhurana15@gmail.com

---

## 🙏 Acknowledgments

- **OpenAI** for GPT-4 API and AI capabilities
- **Google** for Gemini multimodal AI services
- **Supabase** for database and backend services
- **Vercel** for hosting and deployment platform
- **The Open Source Community** for amazing tools and libraries

---

<div align="center">

**Made with ❤️ by the New Hire AI Team**

[Website](https://seekr.workfloww.ai) • [Community](https://workfloww.ai)

</div>
