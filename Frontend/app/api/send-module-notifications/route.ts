import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import nodemailer from 'nodemailer'

// Email transporter configuration with fallback to Ethereal for testing
const createTransporter = async () => {
  // First try Gmail if credentials are provided
  if (process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
    try {
      const gmailTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT) || 587,
        secure: false, // true for port 465, false for 587
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
      })

      // Test the connection
      await gmailTransporter.verify()
      console.log('📧 DEBUG: Gmail SMTP connection verified successfully')
      return gmailTransporter
    } catch (error) {
      console.error('📧 DEBUG: Gmail SMTP failed, falling back to test service:', error)
    }
  }

  // Fallback to Ethereal Email for testing
  console.log('📧 DEBUG: Creating Ethereal test account for email testing...')
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

  console.log('📧 DEBUG: Using Ethereal test email service')
  console.log(`📧 DEBUG: Preview emails at: https://ethereal.email/`)
  return testTransporter
}

// Email template for new module notification
const generateEmailTemplate = (employeeName: string, moduleTitle: string, companyName: string) => {
  return {
    subject: `New Training Module Available: ${moduleTitle}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New Training Module</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px 20px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f8f9fa; padding: 30px 20px; border-radius: 0 0 10px 10px; }
          .module-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
          .cta-button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎓 New Training Module Available</h1>
            <p>Continue your learning journey with Lucid</p>
          </div>
          <div class="content">
            <p>Hi <strong>${employeeName}</strong>,</p>
            
            <p>Great news! A new training module has been uploaded and is now available for you to complete.</p>
            
            <div class="module-box">
              <h3>📚 ${moduleTitle}</h3>
              <p><strong>Company:</strong> ${companyName}</p>
              <p><strong>Status:</strong> Ready to start</p>
              <p>This module has been specifically assigned to you as part of your learning path.</p>
            </div>
            
            <p>Ready to expand your knowledge? Click the button below to access your learning dashboard:</p>
            
            <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/login" class="cta-button">
              Start Learning →
            </a>
            
            <p><strong>Why continuous learning matters:</strong></p>
            <ul>
              <li>🚀 Advance your career with new skills</li>
              <li>💡 Stay updated with industry best practices</li>
              <li>🎯 Achieve your professional development goals</li>
              <li>🏆 Unlock new opportunities within your organization</li>
            </ul>
            
            <p>Questions about this training? Feel free to reach out to your learning administrator or HR team.</p>
            
            <p>Happy learning!<br>
            <strong>The Lucid Learning Team</strong></p>
          </div>
          <div class="footer">
            <p>This email was sent by Lucid Learning Platform.<br>
            If you have any questions, please contact your administrator.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
      Hi ${employeeName},
      
      A new training module "${moduleTitle}" has been uploaded and is now available for you to complete.
      
      Company: ${companyName}
      Status: Ready to start
      
      Login to your learning dashboard to get started: ${process.env.FRONTEND_URL || 'http://localhost:3000'}/login
      
      Happy learning!
      The Lucid Learning Team
    `
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { moduleId, moduleTitle, companyId } = body

    if (!moduleId || !moduleTitle || !companyId) {
      return NextResponse.json(
        { error: 'Missing required fields: moduleId, moduleTitle, or companyId' },
        { status: 400 }
      )
    }

    console.log('📧 DEBUG: Processing email notifications for:', { moduleId, moduleTitle, companyId })

    // Get company details
    const { data: companyData, error: companyError } = await supabase
      .from('companies')
      .select('name')
      .eq('id', companyId)
      .single()

    if (companyError) {
      console.error('📧 DEBUG: Error fetching company:', companyError)
      return NextResponse.json(
        { error: 'Failed to fetch company details' },
        { status: 500 }
      )
    }

    // Get all employees for this company
    const { data: employees, error: employeesError } = await supabase
      .from('employees')
      .select('id, name, email')
      .eq('company_id', companyId)
    
    if (employeesError) {
      console.error('📧 DEBUG: Error fetching employees:', employeesError)
      return NextResponse.json(
        { error: 'Failed to fetch employees', details: employeesError.message },
        { status: 500 }
      )
    }

    if (!employees || employees.length === 0) {
      console.log('📧 DEBUG: No employees found for company:', companyId)
      return NextResponse.json(
        { message: 'No employees found to notify' },
        { status: 200 }
      )
    }

    console.log(`📧 DEBUG: Found ${employees.length} employees to notify`)

    // Create email transporter
    const transporter = await createTransporter()

    // Send emails to all active employees
    const emailPromises = employees.map(async (employee) => {
      const employeeName = employee.name || 'Employee'
      const emailTemplate = generateEmailTemplate(employeeName, moduleTitle, companyData.name)

      try {
        console.log("📧 DEBUG: Sending email to:", employee.email)
        await transporter.sendMail({
          from: `"Lucid Learning" <${process.env.SMTP_USER || 'no-reply@ethereal.email'}>`,
          to: employee.email,
          subject: emailTemplate.subject,
          html: emailTemplate.html,
          text: emailTemplate.text,
        })

        console.log(`📧 DEBUG: Email sent successfully to ${employee.email}`)
        return { 
          success: true, 
          email: employee.email, 
          employeeName 
        }
      } catch (emailError) {
        console.error(`📧 DEBUG: Failed to send email to ${employee.email}:`, emailError)
        return { 
          success: false, 
          email: employee.email, 
          employeeName, 
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

    console.log(`📧 DEBUG: Email notifications completed - ${successfulEmails.length} successful, ${failedEmails.length} failed`)

    return NextResponse.json({
      success: true,
      message: `Email notifications sent to ${successfulEmails.length} out of ${employees.length} employees`,
      moduleId,
      moduleTitle,
      companyName: companyData.name,
      emailsSent: successfulEmails.length,
      emailsFailed: failedEmails.length,
      results: {
        successful: successfulEmails,
        failed: failedEmails
      }
    })

  } catch (error) {
    console.error('📧 DEBUG: Error in send-module-notifications API:', error)
    return NextResponse.json(
      { 
        error: 'Failed to send email notifications',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}