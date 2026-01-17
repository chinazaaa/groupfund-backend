/**
 * iCalendar (iCal) Generator Utility
 * Generates calendar files compatible with Google Calendar, Apple Calendar, Outlook, etc.
 * Based on RFC 5545 iCalendar specification
 */

/**
 * Escape text content for iCal format
 * @param {string} text - Text to escape
 * @returns {string} - Escaped text
 */
function escapeICalText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

/**
 * Format date to iCal format (YYYYMMDDTHHMMSSZ)
 * @param {Date} date - Date to format
 * @param {boolean} allDay - Whether this is an all-day event
 * @returns {string} - Formatted date string
 */
function formatICalDate(date, allDay = true) {
  if (!date) return '';
  
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  
  if (allDay) {
    return `${year}${month}${day}`;
  }
  
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  const seconds = String(d.getUTCSeconds()).padStart(2, '0');
  
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Generate a unique ID for a calendar event
 * @param {string} prefix - Prefix for the ID
 * @param {string|number} identifier - Unique identifier
 * @param {string} domain - Domain for the ID
 * @returns {string} - Unique calendar ID
 */
function generateUID(prefix, identifier, domain = 'groupfund.app') {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  return `${prefix}-${identifier}-${timestamp}@${domain}`;
}

/**
 * Generate iCal content for a birthday event
 * @param {Object} birthday - Birthday data
 * @param {Object} options - Options for the event
 * @returns {string} - iCal event string
 */
function generateBirthdayEvent(birthday, options = {}) {
  const {
    userId,
    userName,
    birthdayDate,
    groupId,
    groupName,
    currency,
    contributionAmount,
    reminderDays = [7, 1] // Default reminders 7 days and 1 day before
  } = birthday;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Calculate next birthday
  const birthDate = new Date(birthdayDate);
  let nextBirthday = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate());
  if (nextBirthday < today) {
    nextBirthday = new Date(today.getFullYear() + 1, birthDate.getMonth(), birthDate.getDate());
  }
  
  const startDate = formatICalDate(nextBirthday, true);
  const endDate = formatICalDate(new Date(nextBirthday.getTime() + 24 * 60 * 60 * 1000), true);
  const uid = generateUID('birthday', `${userId}-${groupId}`, options.domain);
  const created = formatICalDate(new Date(), false);
  const description = escapeICalText(
    `Birthday reminder for ${userName}${groupName ? ` in ${groupName}` : ''}.` +
    (contributionAmount ? ` Contribution: ${currency || 'NGN'} ${contributionAmount}` : '')
  );
  
  let ical = `BEGIN:VEVENT\r\n`;
  ical += `UID:${uid}\r\n`;
  ical += `DTSTAMP:${created}\r\n`;
  ical += `DTSTART;VALUE=DATE:${startDate}\r\n`;
  ical += `DTEND;VALUE=DATE:${endDate}\r\n`;
  ical += `SUMMARY:${escapeICalText(`${userName}'s Birthday${groupName ? ` - ${groupName}` : ''}`)}\r\n`;
  ical += `DESCRIPTION:${description}\r\n`;
  
  // Add reminders/alarms
  if (Array.isArray(reminderDays)) {
    reminderDays.forEach(days => {
      if (days > 0 && days <= 365) {
        const reminderDate = new Date(nextBirthday);
        reminderDate.setDate(reminderDate.getDate() - days);
        reminderDate.setHours(9, 0, 0, 0); // 9 AM reminder
        
        ical += `BEGIN:VALARM\r\n`;
        ical += `TRIGGER:-P${days}D\r\n`; // P = period, D = days, - = before
        ical += `ACTION:DISPLAY\r\n`;
        ical += `DESCRIPTION:${escapeICalText(`${userName}'s birthday is in ${days} ${days === 1 ? 'day' : 'days'}`)}\r\n`;
        ical += `END:VALARM\r\n`;
      }
    });
  }
  
  // Make it recurring yearly
  ical += `RRULE:FREQ=YEARLY;INTERVAL=1\r\n`;
  
  ical += `END:VEVENT\r\n`;
  
  return ical;
}

/**
 * Generate iCal content for a subscription deadline event
 * @param {Object} subscription - Subscription data
 * @param {Object} options - Options for the event
 * @returns {string} - iCal event string
 */
function generateSubscriptionEvent(subscription, options = {}) {
  const {
    groupId,
    groupName,
    subscriptionPlatform,
    subscriptionFrequency, // 'monthly' or 'annual'
    subscriptionDeadlineDay,
    subscriptionDeadlineMonth, // For annual subscriptions
    currency,
    contributionAmount,
    reminderDays = [7, 1] // Default reminders
  } = subscription;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();
  
  // Calculate next deadline
  let nextDeadline;
  
  if (subscriptionFrequency === 'monthly') {
    // Next deadline is the deadline day of current or next month
    if (currentDay <= subscriptionDeadlineDay) {
      nextDeadline = new Date(currentYear, currentMonth - 1, subscriptionDeadlineDay);
    } else {
      nextDeadline = new Date(currentYear, currentMonth, subscriptionDeadlineDay);
    }
    
    // Handle months with fewer days (e.g., if deadline is 31 but month only has 30 days)
    const lastDayOfMonth = new Date(nextDeadline.getFullYear(), nextDeadline.getMonth() + 1, 0).getDate();
    const actualDeadlineDay = Math.min(subscriptionDeadlineDay, lastDayOfMonth);
    nextDeadline.setDate(actualDeadlineDay);
  } else {
    // Annual subscription
    if (currentMonth < subscriptionDeadlineMonth || 
        (currentMonth === subscriptionDeadlineMonth && currentDay <= subscriptionDeadlineDay)) {
      nextDeadline = new Date(currentYear, subscriptionDeadlineMonth - 1, subscriptionDeadlineDay);
    } else {
      nextDeadline = new Date(currentYear + 1, subscriptionDeadlineMonth - 1, subscriptionDeadlineDay);
    }
    
    // Handle February 29th case
    const lastDayOfMonth = new Date(nextDeadline.getFullYear(), nextDeadline.getMonth() + 1, 0).getDate();
    const actualDeadlineDay = Math.min(subscriptionDeadlineDay, lastDayOfMonth);
    nextDeadline.setDate(actualDeadlineDay);
  }
  
  nextDeadline.setHours(0, 0, 0, 0);
  
  const startDate = formatICalDate(nextDeadline, true);
  const endDate = formatICalDate(new Date(nextDeadline.getTime() + 24 * 60 * 60 * 1000), true);
  const uid = generateUID('subscription', groupId, options.domain);
  const created = formatICalDate(new Date(), false);
  const description = escapeICalText(
    `Contribution deadline for ${subscriptionPlatform || groupName} subscription.` +
    (contributionAmount ? ` Amount: ${currency || 'NGN'} ${contributionAmount}` : '')
  );
  
  let ical = `BEGIN:VEVENT\r\n`;
  ical += `UID:${uid}\r\n`;
  ical += `DTSTAMP:${created}\r\n`;
  ical += `DTSTART;VALUE=DATE:${startDate}\r\n`;
  ical += `DTEND;VALUE=DATE:${endDate}\r\n`;
  ical += `SUMMARY:${escapeICalText(`${subscriptionPlatform || groupName} - Contribution Deadline`)}\r\n`;
  ical += `DESCRIPTION:${description}\r\n`;
  
  // Add reminders
  if (Array.isArray(reminderDays)) {
    reminderDays.forEach(days => {
      if (days > 0 && days <= 365) {
        ical += `BEGIN:VALARM\r\n`;
        ical += `TRIGGER:-P${days}D\r\n`;
        ical += `ACTION:DISPLAY\r\n`;
        ical += `DESCRIPTION:${escapeICalText(`Contribution deadline for ${subscriptionPlatform || groupName} is in ${days} ${days === 1 ? 'day' : 'days'}`)}\r\n`;
        ical += `END:VALARM\r\n`;
      }
    });
  }
  
  // Make it recurring
  if (subscriptionFrequency === 'monthly') {
    ical += `RRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=${subscriptionDeadlineDay}\r\n`;
  } else {
    ical += `RRULE:FREQ=YEARLY;INTERVAL=1;BYMONTH=${subscriptionDeadlineMonth};BYMONTHDAY=${subscriptionDeadlineDay}\r\n`;
  }
  
  ical += `END:VEVENT\r\n`;
  
  return ical;
}

/**
 * Generate iCal content for a general group deadline event
 * @param {Object} generalGroup - General group data
 * @param {Object} options - Options for the event
 * @returns {string} - iCal event string
 */
function generateGeneralGroupEvent(generalGroup, options = {}) {
  const {
    groupId,
    groupName,
    deadline,
    currency,
    contributionAmount,
    reminderDays = [7, 1] // Default reminders
  } = generalGroup;

  if (!deadline) {
    return '';
  }
  
  const deadlineDate = new Date(deadline);
  deadlineDate.setHours(0, 0, 0, 0);
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Skip if deadline has passed (for one-time events)
  if (deadlineDate < today) {
    return '';
  }
  
  const startDate = formatICalDate(deadlineDate, true);
  const endDate = formatICalDate(new Date(deadlineDate.getTime() + 24 * 60 * 60 * 1000), true);
  const uid = generateUID('general', groupId, options.domain);
  const created = formatICalDate(new Date(), false);
  const description = escapeICalText(
    `Contribution deadline for ${groupName}.` +
    (contributionAmount ? ` Amount: ${currency || 'NGN'} ${contributionAmount}` : '')
  );
  
  let ical = `BEGIN:VEVENT\r\n`;
  ical += `UID:${uid}\r\n`;
  ical += `DTSTAMP:${created}\r\n`;
  ical += `DTSTART;VALUE=DATE:${startDate}\r\n`;
  ical += `DTEND;VALUE=DATE:${endDate}\r\n`;
  ical += `SUMMARY:${escapeICalText(`${groupName} - Contribution Deadline`)}\r\n`;
  ical += `DESCRIPTION:${description}\r\n`;
  
  // Add reminders
  if (Array.isArray(reminderDays)) {
    reminderDays.forEach(days => {
      if (days > 0 && days <= 365) {
        const reminderDate = new Date(deadlineDate);
        reminderDate.setDate(reminderDate.getDate() - days);
        if (reminderDate >= today) {
          ical += `BEGIN:VALARM\r\n`;
          ical += `TRIGGER:-P${days}D\r\n`;
          ical += `ACTION:DISPLAY\r\n`;
          ical += `DESCRIPTION:${escapeICalText(`Contribution deadline for ${groupName} is in ${days} ${days === 1 ? 'day' : 'days'}`)}\r\n`;
          ical += `END:VALARM\r\n`;
        }
      }
    });
  }
  
  // Note: General groups are typically one-time events, so no RRULE
  // If you want recurring events for general groups, you'd need to add that logic here
  
  ical += `END:VEVENT\r\n`;
  
  return ical;
}

/**
 * Generate a complete iCal calendar file
 * @param {Array} events - Array of iCal event strings
 * @param {Object} options - Calendar options
 * @returns {string} - Complete iCal file content
 */
function generateCalendar(events, options = {}) {
  const {
    name = 'GroupFund Calendar',
    description = 'Birthdays and deadlines from GroupFund',
    prodId = '-//GroupFund//Calendar//EN',
    calScale = 'GREGORIAN',
    method = 'PUBLISH',
    timezone = 'UTC'
  } = options;
  
  let ical = `BEGIN:VCALENDAR\r\n`;
  ical += `VERSION:2.0\r\n`;
  ical += `PRODID:${prodId}\r\n`;
  ical += `CALSCALE:${calScale}\r\n`;
  ical += `METHOD:${method}\r\n`;
  ical += `X-WR-CALNAME:${escapeICalText(name)}\r\n`;
  ical += `X-WR-CALDESC:${escapeICalText(description)}\r\n`;
  ical += `X-WR-TIMEZONE:${timezone}\r\n`;
  
  // Add all events
  events.forEach(event => {
    if (event) {
      ical += event;
    }
  });
  
  ical += `END:VCALENDAR\r\n`;
  
  return ical;
}

module.exports = {
  escapeICalText,
  formatICalDate,
  generateUID,
  generateBirthdayEvent,
  generateSubscriptionEvent,
  generateGeneralGroupEvent,
  generateCalendar
};
