// SMS Service for Egyptian SMS Gateways
// Supports: Vodafone Business, Etisalat, Orange, and Twilio (international)

import prisma from '@/lib/prisma'

export interface SMSConfig {
  gateway: 'VODAFONE' | 'ETISALAT' | 'ORANGE' | 'TWILIO'
  apiKey: string
  senderId: string
  route?: string
  authKey?: string
}

export interface SMSPayload {
  hospitalId?: string
  phone: string
  message: string
  patientId?: string
  templateId?: string
  scheduledFor?: Date
}

class SMSService {
  private config: SMSConfig | null = null

  async initialize() {
    // Load SMS configuration from settings
    const settings = await prisma.setting.findMany({
      where: {
        category: 'sms',
      },
    })

    if (settings.length === 0) {
      throw new Error('SMS gateway not configured')
    }

    this.config = {
      gateway: (settings.find((s) => s.key === 'sms.gateway')?.value || 'VODAFONE') as any,
      apiKey: settings.find((s) => s.key === 'sms.apiKey')?.value || '',
      senderId: settings.find((s) => s.key === 'sms.senderId')?.value || '',
      route: settings.find((s) => s.key === 'sms.route')?.value,
      authKey: settings.find((s) => s.key === 'sms.authKey')?.value,
    }

    if (!this.config.apiKey) {
      throw new Error('SMS API key not configured')
    }
  }

  async sendSMS(payload: SMSPayload): Promise<string> {
    // Validate phone number (Egyptian format: 01XXXXXXXXX)
    if (!this.isValidEgyptianPhoneNumber(payload.phone)) {
      throw new Error('Invalid phone number format')
    }

    // Check DND registry if patient is provided
    if (payload.patientId) {
      const preference = await prisma.patientCommunicationPreference.findUnique({
        where: { patientId: payload.patientId },
      })

      if (preference?.dndRegistered) {
        throw new Error('Patient is on DND registry')
      }

      if (!preference?.smsEnabled) {
        throw new Error('Patient has disabled SMS communication')
      }
    }

    // Check time restrictions (9 AM to 9 PM Cairo time)
    if (!this.isWithinAllowedTime()) {
      throw new Error('SMS cannot be sent outside 9 AM - 9 PM Cairo time')
    }

    // Create SMS log entry
    const smsLog = await prisma.sMSLog.create({
      data: {
        hospitalId: payload.hospitalId || '',
        patientId: payload.patientId || null,
        phone: payload.phone,
        message: payload.message,
        templateId: payload.templateId || null,
        scheduledFor: payload.scheduledFor,
        status: payload.scheduledFor ? 'PENDING' : 'QUEUED',
        gateway: this.config?.gateway,
      },
    })

    // If scheduled for later, return
    if (payload.scheduledFor && payload.scheduledFor > new Date()) {
      return smsLog.id
    }

    // Send SMS immediately
    try {
      await this.initialize()
      const result = await this.sendViaGateway(payload)

      // Update SMS log
      await prisma.sMSLog.update({
        where: { id: smsLog.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          messageId: result.messageId,
          cost: result.cost,
        },
      })

      return smsLog.id
    } catch (error: any) {
      // Update SMS log with error
      await prisma.sMSLog.update({
        where: { id: smsLog.id },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          errorMessage: error.message,
        },
      })

      throw error
    }
  }

  async sendBulkSMS(payloads: SMSPayload[]): Promise<string[]> {
    const results = await Promise.allSettled(payloads.map((payload) => this.sendSMS(payload)))

    return results.map((result, index) => (result.status === 'fulfilled' ? result.value : ''))
  }

  private async sendViaGateway(payload: SMSPayload): Promise<{ messageId: string; cost?: number }> {
    if (!this.config) {
      await this.initialize()
    }

    switch (this.config?.gateway) {
      case 'VODAFONE':
        return this.sendViaVodafone(payload)
      case 'ETISALAT':
        return this.sendViaEtisalat(payload)
      case 'ORANGE':
        return this.sendViaOrange(payload)
      case 'TWILIO':
        return this.sendViaTwilio(payload)
      default:
        throw new Error('Unsupported SMS gateway')
    }
  }

  /** Vodafone Egypt Business SMS. */
  private async sendViaVodafone(payload: SMSPayload): Promise<{ messageId: string; cost?: number }> {
    const url = 'https://api.vodafone.com.eg/sms/v1/send'

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config?.apiKey || ''}`,
      },
      body: JSON.stringify({
        senderName: this.config?.senderId,
        recipients: [`+20${this.normalizePhoneNumber(payload.phone)}`],
        content: payload.message,
      }),
    })

    const data = await response.json()

    if (data.error) {
      throw new Error(data.error_description || 'Failed to send SMS via Vodafone')
    }

    return {
      messageId: data.messageId || data.requestId || '',
      cost: data.cost,
    }
  }

  /** Etisalat Egypt Business SMS. */
  private async sendViaEtisalat(payload: SMSPayload): Promise<{ messageId: string; cost?: number }> {
    const url = 'https://api.etisalat.com.eg/sms/v1/send'

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': this.config?.apiKey || '',
      },
      body: JSON.stringify({
        sender: this.config?.senderId,
        msisdn: `+20${this.normalizePhoneNumber(payload.phone)}`,
        message: payload.message,
      }),
    })

    const data = await response.json()

    if (data.statusCode && data.statusCode >= 400) {
      throw new Error(data.message || 'Failed to send SMS via Etisalat')
    }

    return {
      messageId: data.messageId || '',
      cost: data.cost,
    }
  }

  /** Orange Egypt Business SMS. */
  private async sendViaOrange(payload: SMSPayload): Promise<{ messageId: string; cost?: number }> {
    const url = 'https://api.orange.com.eg/sms/v1/send'

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config?.apiKey || ''}`,
      },
      body: JSON.stringify({
        sender: this.config?.senderId,
        to: `+20${this.normalizePhoneNumber(payload.phone)}`,
        text: payload.message,
      }),
    })

    const data = await response.json()

    if (data.error) {
      throw new Error(data.error_description || 'Failed to send SMS via Orange')
    }

    return {
      messageId: data.messageId || '',
      cost: data.cost,
    }
  }

  private async sendViaTwilio(payload: SMSPayload): Promise<{ messageId: string; cost?: number }> {
    // Twilio implementation
    const accountSid = this.config?.authKey
    const authToken = this.config?.apiKey
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`

    const params = new URLSearchParams({
      To: '+20' + this.normalizePhoneNumber(payload.phone),
      From: this.config?.senderId || '',
      Body: payload.message,
    })

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      },
      body: params,
    })

    const data = await response.json()

    if (data.error_code) {
      throw new Error(data.error_message || 'Failed to send SMS via Twilio')
    }

    return {
      messageId: data.sid || '',
    }
  }

  private isValidEgyptianPhoneNumber(phone: string): boolean {
    // Egyptian mobile: 01XXXXXXXXX (optionally with +20 / 0020 country code)
    let cleaned = phone.replace(/[\s()-]/g, '')
    if (cleaned.startsWith('+')) cleaned = cleaned.slice(1)
    if (cleaned.startsWith('0020')) cleaned = cleaned.slice(4)
    else if (cleaned.startsWith('20') && cleaned.length === 12) cleaned = cleaned.slice(2)
    return /^01[0125]\d{8}$/.test(cleaned)
  }

  private normalizePhoneNumber(phone: string): string {
    // Return the 10-digit national number without the leading zero (1XXXXXXXXX)
    const cleaned = phone.replace(/\D/g, '')
    if (cleaned.length === 11 && cleaned.startsWith('01')) return cleaned.slice(1)
    if (cleaned.length === 12 && cleaned.startsWith('20')) return cleaned.slice(2)
    return cleaned.slice(-10)
  }

  private isWithinAllowedTime(): boolean {
    const now = new Date()
    // Hour of day in Africa/Cairo (UTC+2, UTC+3 during DST)
    const cairoHour = parseInt(
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: 'numeric', hour12: false }).format(now),
      10
    )

    // Allow SMS between 9 AM and 9 PM Cairo time
    return cairoHour >= 9 && cairoHour < 21
  }

  async processTemplate(templateId: string, variables: Record<string, string>): Promise<string> {
    const template = await prisma.communicationTemplate.findUnique({
      where: { id: templateId },
    })

    if (!template || !template.isActive) {
      throw new Error('Template not found or inactive')
    }

    let content = template.content

    // Replace variables in template
    for (const [key, value] of Object.entries(variables)) {
      content = content.replace(new RegExp(`{{${key}}}`, 'g'), value)
    }

    return content
  }

  async getDeliveryStatus(smsLogId: string): Promise<string> {
    const smsLog = await prisma.sMSLog.findUnique({
      where: { id: smsLogId },
    })

    if (!smsLog) {
      throw new Error('SMS log not found')
    }

    // In a real implementation, you would query the gateway API for delivery status
    return smsLog.status
  }

  async getSMSHistory(filters: {
    patientId?: string
    phone?: string
    status?: string
    from?: Date
    to?: Date
    limit?: number
  }) {
    const where: any = {}

    if (filters.patientId) where.patientId = filters.patientId
    if (filters.phone) where.phone = { contains: filters.phone }
    if (filters.status) where.status = filters.status
    if (filters.from || filters.to) {
      where.createdAt = {}
      if (filters.from) where.createdAt.gte = filters.from
      if (filters.to) where.createdAt.lte = filters.to
    }

    return prisma.sMSLog.findMany({
      where,
      include: {
        template: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: filters.limit || 100,
    })
  }

  async checkBalance(): Promise<{ balance: number; currency: string }> {
    // This would query the SMS gateway for current balance
    // Implementation depends on gateway
    return {
      balance: 0,
      currency: 'EGP',
    }
  }
}

export const smsService = new SMSService()
