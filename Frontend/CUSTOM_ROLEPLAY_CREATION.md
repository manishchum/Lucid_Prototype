# Custom Roleplay Creation Feature

## Overview

The Custom Roleplay Creation feature allows users to design and configure personalized roleplay scenarios tailored to their specific training needs. This comprehensive form provides granular control over all aspects of the roleplay experience.

## Navigation

To access the custom roleplay creation page:
1. Navigate to `/employee/roleplay`
2. Click on the "Create Your Own Roleplay" card (purple dashed border)
3. You'll be redirected to `/employee/roleplay/create`

## Features

### 1. **Learner Brief** 📝
Define what learners will see before starting the roleplay:
- **Scenario Title**: Name of the roleplay scenario
- **Your Role**: The role the learner will play
- **Instructions for Learners**: Detailed briefing with formatting options
  - Rich text editor with basic formatting (Bold, Italic, Underline)
  - Support for bullet lists and numbered lists
  - Adjustable font sizes
  - Link insertion capability

### 2. **Avatar Instructions** 🎭
Configure the AI character's behavior:
- **AI Character Role**: Define who the AI will portray (e.g., Doctor, Manager, Client)
- **Personality & Tone**: Choose from:
  - Friendly (warm and approachable)
  - Neutral (professional and balanced)
  - Aggressive (challenging and critical)
- **AI Personality Description**: Detailed behavioral guidelines
- **AI's Opening Line**: The first message from the AI character
- **AI's Objectives & Guidelines**: What the AI should test or achieve
- **Difficulty Level**: 
  - Easy: Basic questions and supportive responses
  - Medium: Moderate challenges and objections
  - Hard: Complex scenarios with strong objections

### 3. **End Conditions** 🏁
Define when the session should automatically end:
- **Maximum Duration**: Set time limit (1-60 minutes)
- **Minimum Conversation Turns**: Required back-and-forth exchanges
- **Custom End Conditions**: Specific criteria that trigger session end

### 4. **Evaluation Parameters** 📊
Create custom assessment criteria:
- Add multiple evaluation parameters
- Each parameter includes:
  - Name
  - Description
  - Weight (percentage)
- Total weight must equal 100%
- Default parameters provided:
  - Communication Skills (25%)
  - Problem Solving (25%)
  - Professionalism (25%)
  - Goal Achievement (25%)

### 5. **Cut Off Score** 🎯
Set the minimum passing score:
- Adjustable via slider or direct input (0-100%)
- Visual interpretation of pass/fail thresholds
- Default: 60%
- Recommendations provided based on use case

### 6. **Reviewers** 👥
*(Coming Soon)*
- Add managers or supervisors
- Enable review and feedback capabilities
- Track reviewer assignments

### 7. **Insights** 💡
*(Data available after learner completions)*
- Completion statistics
- Average scores
- Pass rates
- Common challenges
- Performance trends

## Usage Flow

### Creating a Custom Roleplay

1. **Start Creation**
   - Click "Create Your Own Roleplay" from the roleplay selection screen

2. **Fill in Required Fields**
   - Navigate through tabs using the left sidebar
   - Fields marked with * are required:
     - Scenario Title
     - Your Role
     - Learner Brief
     - AI Character Role
     - AI's Opening Line

3. **Configure Evaluation** (Optional but Recommended)
   - Adjust evaluation parameters
   - Ensure weights total 100%
   - Set appropriate cutoff score

4. **Save or Start**
   - **Save Draft**: Store your work in browser localStorage
   - **Start Roleplay**: Launch the scenario immediately

### Starting the Roleplay

When you click "Start Roleplay":
1. Form validation occurs
2. Custom scenario is saved to sessionStorage
3. You're redirected to `/employee/roleplay?custom=true`
4. The roleplay conversation begins immediately
5. All evaluation criteria are applied during assessment

## Technical Implementation

### Data Structure

```typescript
interface CustomRoleplayData {
  title: string;
  description: string;
  learnerBrief: string;
  aiRole: string;
  aiPersonality: string;
  aiObjectives: string;
  endConditions: string;
  maxDuration: number;
  minTurns: number;
  evaluationParameters: Array<{
    name: string;
    description: string;
    weight: number;
  }>;
  cutoffScore: number;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  tone: 'Friendly' | 'Neutral' | 'Aggressive';
  userRole: string;
  initialPrompt: string;
}
```

### Storage

- **sessionStorage**: Used for active scenario transfer between pages
- **localStorage**: Used for draft saving functionality

### Navigation

- Main roleplay page: `/employee/roleplay/page.tsx`
- Creation page: `/employee/roleplay/create/page.tsx`
- Cards redirect using `router.push()`
- Custom scenario loaded via URL parameter `?custom=true`

## Validation

The form validates:
- ✅ All required fields are filled
- ✅ Evaluation parameter weights total 100%
- ✅ Numeric values are within acceptable ranges

Error messages are displayed prominently at the top of the page.

## Future Enhancements

1. **Rich Text Editor**: Full WYSIWYG editor for learner brief
2. **Templates**: Pre-built scenario templates for common use cases
3. **Scenario Library**: Save and reuse custom scenarios
4. **Collaborative Creation**: Multiple users contributing to scenarios
5. **AI-Assisted Generation**: Suggest scenarios based on learning objectives
6. **Version History**: Track changes and iterations
7. **Import/Export**: Share scenarios across organizations

## Best Practices

### Writing Effective Learner Briefs
- Be clear and concise
- Include specific objectives
- List what learners need to do
- Provide context about the scenario

### Designing AI Characters
- Make personality consistent with role
- Provide specific behavioral examples
- Align difficulty with learner experience level
- Set clear objectives for AI interaction

### Creating Fair Evaluations
- Use 4-6 evaluation parameters
- Weight parameters based on learning objectives
- Provide clear descriptions for each parameter
- Set realistic cutoff scores (60-70% typical)

## Troubleshooting

### Scenario Not Loading
- Check browser console for errors
- Verify sessionStorage has data
- Ensure navigation includes `?custom=true` parameter

### Validation Errors
- Ensure all required (*) fields are filled
- Verify evaluation weights total exactly 100%
- Check numeric ranges are within limits

### Draft Not Saving
- Check browser localStorage permissions
- Verify sufficient storage space
- Clear old drafts if needed

## Support

For issues or questions:
- Check browser console for error messages
- Review this documentation
- Contact your system administrator

---

**Version**: 1.0.0  
**Last Updated**: January 2026  
**Component**: `/app/employee/roleplay/create/page.tsx`
