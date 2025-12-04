const express = require('express');
const router = express.Router();
const pool = require('../db');

// ...existing code...

// Check baseline assessment status for a user
router.get('/baseline-status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Check if user has baseline assessment assigned
    const assignedBaselineQuery = `
      SELECT lp.learning_plan_id, lp.baseline_assessment 
      FROM learning_plan lp 
      WHERE lp.user_id = $1 AND lp.baseline_assessment = 1
    `;
    
    const assignedBaseline = await pool.query(assignedBaselineQuery, [userId]);
    
    // Check if user has completed baseline assessment
    const completedBaselineQuery = `
      SELECT ea.employee_assessment_id, ea.completed_at
      FROM employee_assessments ea
      JOIN assessments a ON ea.assessment_id = a.assessment_id
      WHERE ea.user_id = $1 AND a.type = 'baseline'
    `;
    
    const completedBaseline = await pool.query(completedBaselineQuery, [userId]);
    
    const status = {
      isAssigned: assignedBaseline.rows.length > 0,
      isCompleted: completedBaseline.rows.length > 0,
      canTakeAssessment: assignedBaseline.rows.length > 0 && completedBaseline.rows.length === 0
    };
    
    res.json(status);
  } catch (error) {
    console.error('Error checking baseline status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get nudges data for a user
router.get('/nudges/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get pending learning plans
    const pendingPlansQuery = `
      SELECT lp.learning_plan_id, lp.assigned_on, lp.due_date, lp.priority,
             tm.title as module_title, tm.description
      FROM learning_plan lp
      JOIN training_modules tm ON lp.module_id = tm.module_id
      WHERE lp.user_id = $1 AND lp.status = 'ASSIGNED'
      ORDER BY lp.due_date ASC, lp.priority DESC
      LIMIT 5
    `;
    
    const pendingPlans = await pool.query(pendingPlansQuery, [userId]);
    
    // Get overdue learning plans
    const overduePlansQuery = `
      SELECT lp.learning_plan_id, lp.assigned_on, lp.due_date, lp.priority,
             tm.title as module_title, tm.description
      FROM learning_plan lp
      JOIN training_modules tm ON lp.module_id = tm.module_id
      WHERE lp.user_id = $1 AND lp.status IN ('ASSIGNED', 'IN_PROGRESS') 
        AND lp.due_date < CURRENT_DATE
      ORDER BY lp.due_date ASC
      LIMIT 3
    `;
    
    const overduePlans = await pool.query(overduePlansQuery, [userId]);
    
    // Get recent completions for motivation
    const recentCompletionsQuery = `
      SELECT lp.learning_plan_id, lp.completed_at,
             tm.title as module_title
      FROM learning_plan lp
      JOIN training_modules tm ON lp.module_id = tm.module_id
      WHERE lp.user_id = $1 AND lp.status = 'COMPLETED'
      ORDER BY lp.completed_at DESC
      LIMIT 3
    `;
    
    const recentCompletions = await pool.query(recentCompletionsQuery, [userId]);
    
    // Generate nudges based on the data
    const nudges = [];
    
    // Baseline assessment nudge
    const baselineStatusQuery = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM learning_plan WHERE user_id = $1 AND baseline_assessment = 1) as assigned,
        (SELECT COUNT(*) FROM employee_assessments ea 
         JOIN assessments a ON ea.assessment_id = a.assessment_id 
         WHERE ea.user_id = $1 AND a.type = 'baseline') as completed
    `, [userId]);
    
    const baselineStatus = baselineStatusQuery.rows[0];
    if (baselineStatus.assigned > 0 && baselineStatus.completed === 0) {
      nudges.push({
        type: 'baseline_pending',
        title: 'Complete Your Baseline Assessment',
        message: 'Take your baseline assessment to get personalized learning recommendations.',
        priority: 'high',
        actionText: 'Take Assessment',
        actionUrl: '/baseline-assessment'
      });
    }
    
    // Overdue assignments nudge
    if (overduePlans.rows.length > 0) {
      nudges.push({
        type: 'overdue_assignments',
        title: `${overduePlans.rows.length} Overdue Assignment${overduePlans.rows.length > 1 ? 's' : ''}`,
        message: `You have ${overduePlans.rows.length} overdue learning module${overduePlans.rows.length > 1 ? 's' : ''}. Complete them to stay on track.`,
        priority: 'high',
        actionText: 'View Assignments',
        actionUrl: '/learning-plan',
        data: overduePlans.rows
      });
    }
    
    // Upcoming deadlines nudge
    const upcomingDeadlines = pendingPlans.rows.filter(plan => {
      const dueDate = new Date(plan.due_date);
      const today = new Date();
      const daysDiff = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
      return daysDiff <= 7 && daysDiff > 0;
    });
    
    if (upcomingDeadlines.length > 0) {
      nudges.push({
        type: 'upcoming_deadlines',
        title: 'Upcoming Deadlines',
        message: `You have ${upcomingDeadlines.length} assignment${upcomingDeadlines.length > 1 ? 's' : ''} due this week.`,
        priority: 'medium',
        actionText: 'View Details',
        actionUrl: '/learning-plan',
        data: upcomingDeadlines
      });
    }
    
    // Motivational nudge for recent completions
    if (recentCompletions.rows.length > 0) {
      nudges.push({
        type: 'recent_achievements',
        title: 'Great Progress!',
        message: `You've completed ${recentCompletions.rows.length} module${recentCompletions.rows.length > 1 ? 's' : ''} recently. Keep it up!`,
        priority: 'low',
        actionText: 'Continue Learning',
        actionUrl: '/learning-plan',
        data: recentCompletions.rows
      });
    }
    
    // No pending assignments - encourage exploration
    if (pendingPlans.rows.length === 0 && overduePlans.rows.length === 0) {
      nudges.push({
        type: 'explore_learning',
        title: 'All Caught Up!',
        message: 'You\'ve completed all your assigned modules. Explore additional learning opportunities.',
        priority: 'low',
        actionText: 'Browse Modules',
        actionUrl: '/browse-modules'
      });
    }
    
    res.json({
      nudges: nudges.sort((a, b) => {
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      }),
      stats: {
        pendingAssignments: pendingPlans.rows.length,
        overdueAssignments: overduePlans.rows.length,
        recentCompletions: recentCompletions.rows.length,
        baselineCompleted: baselineStatus.completed > 0
      }
    });
    
  } catch (error) {
    console.error('Error fetching nudges:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ...existing code...

module.exports = router;