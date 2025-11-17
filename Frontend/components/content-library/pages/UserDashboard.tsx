import React, { useState, useMemo } from "react";
import { Search } from "lucide-react";

interface Course {
  id: string;
  title: string;
  description: string;
  image: string;
  rating: number;
  learners: number;
  duration: string;
  category: string;
}

const initialCourses: Course[] = [
  {
    id: "1",
    title: "Prompt Engineering",
    description: "Master the art of crafting effective prompts for AI models",
    image: "https://images.unsplash.com/photo-1527689368864-3a821dbccc34?w=400&h=300&fit=crop",
    rating: 4.6,
    learners: 7500,
    duration: "4 hrs",
    category: "AI"
  },
  {
    id: "2",
    title: "AI in HR",
    description: "Revolutionize human resources with artificial intelligence",
    image: "https://images.unsplash.com/photo-1552664730-d307ca884978?w=400&h=300&fit=crop",
    rating: 4.5,
    learners: 5200,
    duration: "3 hrs",
    category: "HR"
  },
  {
    id: "3",
    title: "AI in Marketing",
    description: "Leverage AI to boost your marketing strategies",
    image: "https://images.unsplash.com/photo-1611532736579-6b16e2b50449?w=400&h=300&fit=crop",
    rating: 4.7,
    learners: 8900,
    duration: "5 hrs",
    category: "Marketing"
  },
  {
    id: "4",
    title: "AI in Finance",
    description: "Explore AI applications in financial services",
    image: "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=400&h=300&fit=crop",
    rating: 4.6,
    learners: 6300,
    duration: "4.5 hrs",
    category: "Finance"
  },
  {
    id: "5",
    title: "AI in Sales",
    description: "Use AI to identify leads, personalize outreach and close deals faster.",
    image: "https://images.unsplash.com/photo-1559526324-593bc073d938?w=400&h=300&fit=crop",
    rating: 4.5,
    learners: 9200,
    duration: "3 hrs",
    category: "Sales"
  },
  {
    id: "6",
    title: "Generative AI Foundations",
    description: "Core concepts behind large language and multimodal generative models.",
    image: "https://images.unsplash.com/photo-1545239351-1141bd82e8a6?w=400&h=300&fit=crop",
    rating: 4.6,
    learners: 8100,
    duration: "4 hrs",
    category: "Generative AI"
  },
  {
    id: "7",
    title: "Agentic AI & Auto-Agents",
    description: "Design and orchestrate agentic systems that act autonomously to complete tasks.",
    image: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=400&h=300&fit=crop",
    rating: 4.5,
    learners: 6400,
    duration: "4.5 hrs",
    category: "Agentic AI"
  },
  {
    id: "8",
    title: "AI in Operations",
    description: "Apply AI to automate workflows, forecasting and optimization in operations.",
    image: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=400&h=300&fit=crop",
    rating: 4.6,
    learners: 4800,
    duration: "3.5 hrs",
    category: "Operations"
  },
  {
    id: "9",
    title: "AI Product Management",
    description: "Build and launch AI-powered products with practical product management techniques.",
    image: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=400&h=300&fit=crop",
    rating: 4.4,
    learners: 3700,
    duration: "4 hrs",
    category: "Product"
  },
  {
    id: "10",
    title: "Generative AI for Customer Support",
    description: "Use generative models to automate support, summarize tickets and draft responses.",
    image: "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=400&h=300&fit=crop",
    rating: 4.6,
    learners: 5200,
    duration: "3 hrs",
    category: "Generative AI"
  },
  {
    id: "11",
    title: "Responsible GenAI",
    description: "Principles and practices to deploy generative AI responsibly at scale.",
    image: "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=400&h=300&fit=crop",
    rating: 4.5,
    learners: 3100,
    duration: "2.5 hrs",
    category: "Ethics"
  },
  {
    id: "12",
    title: "Advanced Agentic Systems",
    description: "Design, evaluate and monitor advanced autonomous agent systems in production.",
    image: "https://images.unsplash.com/photo-1526378724791-ff3b3f1a7b4c?w=400&h=300&fit=crop",
    rating: 4.6,
    learners: 4300,
    duration: "5 hrs",
    category: "Agentic AI"
  }
];

const UserDashboard: React.FC<{ activeSection?: string }> = ({ activeSection = 'overview' }) => {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredCourses = useMemo(() => {
    return initialCourses.filter(course =>
      course.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      course.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      course.category.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery]);

  if (activeSection === 'content') {
    return (
      <main style={{ padding: 32 }}>
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ marginBottom: 24, fontSize: 28, fontWeight: 600, color: '#1f2937' }}>
            Browse Courses
          </h1>
          
          {/* Search Bar */}
          <div style={{ position: 'relative', marginBottom: 40 }}>
            <Search style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', width: 20, height: 20, color: '#9ca3af' }} />
            <input
              type="text"
              placeholder="Search courses (Prompt Engineering, AI in HR, Marketing, Finance...)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                paddingLeft: 48,
                paddingRight: 16,
                paddingTop: 12,
                paddingBottom: 12,
                fontSize: 16,
                border: '2px solid #e5e7eb',
                borderRadius: 12,
                outline: 'none',
                transition: 'all 0.3s ease',
                backgroundColor: '#ffffff',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)'
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = '#3b82f6';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(59, 130, 246, 0.2)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = '#e5e7eb';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.08)';
              }}
            />
          </div>

          {/* Courses Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 24,
            maxWidth: 1400
          }}>
            {filteredCourses.map(course => (
              <div
                key={course.id}
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: 16,
                  overflow: 'hidden',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                  transition: 'all 0.3s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  cursor: 'pointer'
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = 'translateY(-8px)';
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.15)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
                }}
              >
                {/* Image */}
                <div style={{ position: 'relative', width: '100%', height: 180, overflow: 'hidden', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                  <img
                    src={course.image}
                    alt={course.title}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.3s ease' }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = 'scale(1.05)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                    }}
                  />
                  
                </div>

                {/* Content */}
                <div style={{ padding: 20, flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a', margin: '0 0 10px 0', lineHeight: 1.3 }}>
                    {course.title}
                  </h3>
                  <p style={{ fontSize: 14, color: '#666', margin: '0 0 15px 0', lineHeight: 1.5, flex: 1 }}>
                    {course.description}
                  </p>

                  {/* Meta */}
                  <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 13, color: '#555' }}>
                    <span>⭐ {course.rating}</span>
                    <span>{(course.learners / 1000).toFixed(1)}K Learners</span>
                  </div>

                  {/* Duration & Category */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, fontSize: 13, color: '#888' }}>
                    <span>⏱️ {course.duration}</span>
                    <span style={{ fontSize: 11, backgroundColor: '#f3f4f6', color: '#6b7280', padding: '4px 8px', borderRadius: 4 }}>
                      {course.category}
                    </span>
                  </div>

                  {/* Button */}
                  <button
                    style={{
                      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      color: 'white',
                      border: 'none',
                      padding: '12px 24px',
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      width: '100%'
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
                      (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
                      (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                    }}
                  >
                    Overview
                  </button>
                </div>
              </div>
            ))}
          </div>

          {filteredCourses.length === 0 && (
            <div style={{ textAlign: 'center', paddingTop: 40, color: '#999', fontSize: 16 }}>
              No courses found. Try a different search.
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main style={{ padding: 32 }}>
      <h1>Welcome to Content Library</h1>
      <p style={{ color: '#666', fontSize: 16 }}>Select "Content Library" to browse available courses.</p>
    </main>
  );
};

export default UserDashboard;
