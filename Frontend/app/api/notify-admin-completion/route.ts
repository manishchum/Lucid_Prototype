import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import nodemailer from 'nodemailer'
import { generateUnsubscribeToken, buildUnsubscribeUrl } from '@/lib/unsubscribe-token'

// Email transporter configuration with fallback to Ethereal for testing
const createTransporter = async () => {
  // First try Gmail if credentials are provided
  if (process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
    try {
      const gmailTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
      })

      // Test the connection
      await gmailTransporter.verify()
      // console.log('📧 DEBUG: Gmail SMTP connection verified successfully')
      return gmailTransporter
    } catch (error) {
      console.error('📧 DEBUG: Gmail SMTP failed, falling back to test service:', error)
    }
  }

  // Fallback to Ethereal Email for testing
  // console.log('📧 DEBUG: Creating Ethereal test account for email testing...')
  const testAccount = await nodemailer.createTestAccount()
  
  const testTransporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  })

  // console.log('📧 DEBUG: Using Ethereal test email service')
  // console.log(`📧 DEBUG: Preview emails at: https://ethereal.email/`)
  return testTransporter
}

// Email template for module completion notification to admin
const generateAdminNotificationTemplate = (
  employeeName: string, 
  moduleTitle: string, 
  companyName: string,
  completionDate: string,
  employeeEmail: string,
  unsubscribeUrl: string,
  adminUserId: string
) => {
  return {
    subject: `Module Completed: ${employeeName} finished "${moduleTitle}"`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Module Completion Notification</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px 20px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f8f9fa; padding: 30px 20px; border-radius: 0 0 10px 10px; }
          .completion-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745; }
          .employee-details { background: #e8f5e8; padding: 15px; border-radius: 6px; margin: 15px 0; }
          .cta-button { display: inline-block; background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 14px; }
          .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 15px 0; }
          .stat-item { background: white; padding: 10px; border-radius: 4px; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Module Completed!</h1>
            <p>Employee Training Progress Update</p>
          </div>
          <div class="content">
            <p>Hello Admin,</p>
            
            <p>Great news! An employee has successfully completed a training module on your Lucid Learning platform.</p>
            
            <div class="completion-box">
              <h3>✅ ${moduleTitle}</h3>
              <div class="employee-details">
                <p><strong>👤 Employee:</strong> ${employeeName}</p>
                <p><strong>📧 Email:</strong> ${employeeEmail}</p>
                <p><strong>🏢 Company:</strong> ${companyName}</p>
                <p><strong>📅 Completed:</strong> ${completionDate}</p>
                <p><strong>📚 Module:</strong> ${moduleTitle}</p>
              </div>
            </div>
            
            <p><strong>🎯 What this means:</strong></p>
            <ul>
              <li>✨ Employee has gained new skills and knowledge</li>
              <li>📈 Your organization's training compliance is improving</li>
              <li>🏆 Another step towards your learning objectives</li>
              <li>💪 Team capability and expertise is expanding</li>
            </ul>
            
            <p>Want to track more progress and analytics? Access your console dashboard:</p>
            
            <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/login" class="cta-button">
              View Dashboard →
            </a>
            
            <p><strong>📊 Keep monitoring your team's learning journey!</strong></p>
            <p>Regular training completion helps maintain high performance standards and keeps your team updated with the latest industry practices.</p>
            
            <p>Best regards,<br>
            <strong>The Lucid Learning System</strong></p>
          </div>
          <div class="footer">
            <p>This is an automated notification from Lucid Learning Platform.<br>
            You are receiving this because you are an administrator for ${companyName}.<br>
            <a href="${unsubscribeUrl}" style="color: #666; text-decoration: none; font-size: 12px;">Unsubscribe from these notifications</a></p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
      Module Completion Notification
      
      Hello,
      
      An employee has successfully completed a training module:
      
      Employee: ${employeeName}
      Email: ${employeeEmail}
      Company: ${companyName}
      Module: ${moduleTitle}
      Completed: ${completionDate}
      
      Access your console: ${process.env.FRONTEND_URL || 'http://localhost:3000'}/login
      
      Best regards,
      The Lucid Learning System
      
      ---
      To unsubscribe from these notifications, visit: ${unsubscribeUrl}
    `
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { employeeId, moduleId, completionDate } = body

    if (!employeeId || !moduleId) {
      return NextResponse.json(
        { error: 'Missing required fields: employeeId or moduleId' },
        { status: 400 }
      )
    }

    // console.log('📧 DEBUG: Processing admin notification for module completion:', { employeeId, moduleId })

    // Get user details
    const { data: employeeData, error: employeeError } = await supabase
      .from('users')
      .select('user_id, name, email, company_id')
      .eq('user_id', employeeId)
      .single()

    if (employeeError) {
      console.error('📧 DEBUG: Error fetching employee:', employeeError)
      return NextResponse.json(
        { error: 'Failed to fetch employee details' },
        { status: 500 }
      )
    }

    // Get module details - check if moduleId is a processed_module_id or module_id
    // First try to fetch from processed_modules to get the actual module_id
    const { data: processedModuleData } = await supabase
      .from('processed_modules')
      .select('module_id')
      .eq('processed_module_id', moduleId)
      .maybeSingle()

    // Use the actual module_id (either from processed_modules or the original moduleId)
    const actualModuleId = processedModuleData?.module_id || moduleId

    console.log('📧 DEBUG: Module ID resolution:', { 
      receivedModuleId: moduleId, 
      actualModuleId,
      fromProcessedModules: !!processedModuleData 
    })

    const { data: moduleData, error: moduleError } = await supabase
      .from('training_modules')
      .select('module_id, title, company_id')
      .eq('module_id', actualModuleId)
      .maybeSingle()

    if (moduleError || !moduleData) {
      console.error('📧 DEBUG: Error fetching module:', moduleError)
      return NextResponse.json(
        { error: 'Failed to fetch module details', details: moduleError },
        { status: 500 }
      )
    }

    // Get company details
    const { data: companyData, error: companyError } = await supabase
      .from('companies')
      .select('name')
      .eq('company_id', employeeData.company_id)
      .single()

    if (companyError) {
      console.error('📧 DEBUG: Error fetching company:', companyError)
      return NextResponse.json(
        { error: 'Failed to fetch company details' },
        { status: 500 }
      )
    }

    // Get admin users for this company using the new role-based system
    // Fetch users with role level >= 3 (Admin level) and NOT unsubscribed
    const { data: adminData, error: adminError } = await supabase
      .from('user_role_assignments')
      .select(`
        user_id,
        users!inner(email, name, company_id, email_unsubscribed)
      `)
      .eq('users.company_id', employeeData.company_id)
      .gte('roles.level', 3)
      .eq('users.email_unsubscribed', false) // Only get subscribed admins
      .eq('is_active', true)
      .eq('scope_type', 'COMPANY')
      .eq('scope_id', employeeData.company_id)
    
    if (adminError) {
      console.error('📧 DEBUG: Error fetching admins:', adminError)
      return NextResponse.json(
        { error: 'Failed to fetch admin details' },
        { status: 500 }
      )
    }

    if (!adminData || adminData.length === 0) {
      // console.log('📧 DEBUG: No admins found for company:', employeeData.company_id)
      return NextResponse.json(
        { message: 'No admins found to notify for this company' },
        { status: 200 }
      )
    }

    const adminEmails = adminData.map((admin: any) => ({
      email: admin.users.email,
      userId: admin.user_id,
      name: admin.users.name
    }))
    // console.log(`📧 DEBUG: Sending notifications to ${adminEmails.length} admins:`, adminEmails.map((a:any) => a.email))

    // Create email transporter
    const transporter = await createTransporter()

    // Format completion date
    const formattedDate = completionDate ? new Date(completionDate).toLocaleString() : new Date().toLocaleString()

    // Send emails to all admins
    const emailPromises = adminEmails.map(async (admin: any) => {
      // Generate unsubscribe token for this admin
      let unsubscribeUrl = ''
      try {
        const token = generateUnsubscribeToken(admin.email, admin.userId)
        unsubscribeUrl = buildUnsubscribeUrl(token)
      } catch (tokenError) {
        console.error('Failed to generate unsubscribe token for admin:', tokenError)
        unsubscribeUrl = `${process.env.NEXT_PUBLIC_APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000'}/unsubscribe-error`
      }

      const emailTemplate = generateAdminNotificationTemplate(
        employeeData.name || 'Employee',
        moduleData.title,
        companyData.name,
        formattedDate,
        employeeData.email,
        unsubscribeUrl,
        admin.userId
      )

      try {
        await transporter.sendMail({
          from: `"Lucid Learning System" <${process.env.SMTP_USER || 'no-reply@ethereal.email'}>`,
          to: admin.email.trim(),
          subject: emailTemplate.subject,
          html: emailTemplate.html,
          text: emailTemplate.text,
        })

        // console.log(`📧 DEBUG: Admin notification sent successfully to ${admin.email}`)
        return { 
          success: true, 
          email: admin.email,
          adminName: admin.name
        }
      } catch (emailError) {
        console.error(`📧 DEBUG: Failed to send admin notification to ${admin.email}:`, emailError)
        return { 
          success: false, 
          email: admin.email,
          error: emailError instanceof Error ? emailError.message : 'Unknown error'
        }
      }
    })

    const emailResults = await Promise.allSettled(emailPromises)
    
    // Process results
    const successfulEmails = emailResults
      .filter((result) => result.status === 'fulfilled' && result.value.success)
      .map((result) => result.status === 'fulfilled' ? result.value : null)
      .filter(Boolean)

    const failedEmails = emailResults
      .filter((result) => result.status === 'fulfilled' && !result.value.success)
      .map((result) => result.status === 'fulfilled' ? result.value : null)
      .filter(Boolean)

    // console.log(`📧 DEBUG: Admin notifications completed - ${successfulEmails.length} successful, ${failedEmails.length} failed`)

    return NextResponse.json({
      success: true,
      message: `Admin notifications sent to ${successfulEmails.length} out of ${adminEmails.length} administrators`,
      employeeName: employeeData.name,
      moduleTitle: moduleData.title,
      companyName: companyData.name,
      emailsSent: successfulEmails.length,
      emailsFailed: failedEmails.length,
      results: {
        successful: successfulEmails,
        failed: failedEmails
      }
    })

  } catch (error) {
    console.error('📧 DEBUG: Error in admin notification API:', error)
    return NextResponse.json(
      { 
        error: 'Failed to send admin notifications',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}