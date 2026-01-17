# Calendar Integration Guide

## Overview
GroupFund now supports calendar integration, allowing users to sync birthdays and contribution deadlines with their favorite calendar apps (Google Calendar, Apple Calendar, Outlook).

## How It Works

### API Endpoints

1. **`GET /api/calendar/feed`** - Main calendar feed (all event types)
   - Query params: `eventType` (optional: 'all', 'birthday', 'subscription', 'general'), `groupId` (optional), `token` (required for auth)
   
2. **`GET /api/calendar/birthdays`** - Birthday events only
   
3. **`GET /api/calendar/subscriptions`** - Subscription deadlines only
   
4. **`GET /api/calendar/general`** - General group deadlines only

5. **`GET /api/calendar/url`** - Get calendar subscription URL with instructions

### Authentication

The calendar feed supports authentication via:
- **Bearer token in Authorization header**: `Authorization: Bearer <token>`
- **Token in query parameter**: `?token=<token>` (recommended for calendar app subscriptions)

### Subscription URL Format

```
https://your-domain.com/api/calendar/feed?token=YOUR_JWT_TOKEN
```

For specific event types:
```
https://your-domain.com/api/calendar/feed?eventType=birthday&token=YOUR_JWT_TOKEN
https://your-domain.com/api/calendar/feed?eventType=subscription&token=YOUR_JWT_TOKEN
https://your-domain.com/api/calendar/feed?eventType=general&token=YOUR_JWT_TOKEN
```

## Setting Up Calendar Subscriptions

### Important: Public Accessibility Requirement

**⚠️ Critical**: Calendar feeds must be publicly accessible. Calendar apps (Google, Apple, Outlook) fetch calendar feeds from their servers, not from your device. This means:

- ✅ **Works**: Public HTTPS URL (e.g., `https://api.groupfund.app/api/calendar/feed?token=...`)
- ❌ **Doesn't work**: Local IP addresses (e.g., `http://192.168.0.189:3000/api/calendar/feed?token=...`)
- ❌ **Doesn't work**: `localhost` or `127.0.0.1`

### For Development/Testing

#### Option 1: Use ngrok (Recommended for Testing)
```bash
# Install ngrok
npm install -g ngrok

# Create tunnel to your local server
ngrok http 3000

# Use the ngrok URL (e.g., https://abc123.ngrok.io/api/calendar/feed?token=...)
```

#### Option 2: Use Your Production Server
Deploy your backend to a publicly accessible server and use that URL.

### Google Calendar

1. Copy your calendar feed URL from `/api/calendar/url` endpoint
2. Open Google Calendar
3. Click the "+" next to "Other calendars"
4. Select "From URL"
5. Paste your calendar feed URL
6. Click "Add calendar"

**Note**: Google Calendar may take a few minutes to sync. The calendar will refresh automatically.

### Apple Calendar (macOS/iOS)

1. Copy your calendar feed URL
2. On macOS:
   - Open Calendar app
   - File → New Calendar Subscription
   - Paste the URL
   - Configure settings (auto-refresh, etc.)
3. On iOS:
   - Open Safari
   - Navigate to the calendar URL
   - It should automatically offer to subscribe

### Outlook

1. Copy your calendar feed URL
2. Open Outlook Calendar (web or desktop)
3. Click "Add calendar" → "Subscribe from web"
4. Paste the URL
5. Configure refresh settings

## Event Types

### Birthday Events
- **Recurrence**: Yearly (repeats every year)
- **Reminders**: 7 days and 1 day before
- **Includes**: Member name, group name, contribution amount

### Subscription Deadlines
- **Recurrence**: 
  - Monthly subscriptions: Monthly (same day each month)
  - Annual subscriptions: Yearly (same month/day each year)
- **Reminders**: 7 days and 1 day before
- **Includes**: Platform name, contribution amount

### General Group Deadlines
- **Recurrence**: One-time event (no recurrence)
- **Reminders**: 7 days and 1 day before
- **Includes**: Group name, contribution amount
- **Note**: Only future deadlines are included in the feed

## Troubleshooting

### Calendar Not Appearing in Google Calendar

1. **Check URL Accessibility**: Ensure the URL is publicly accessible (not localhost/local IP)
2. **Verify Token**: Make sure the token in the URL is valid and not expired
3. **Check Format**: Google Calendar requires valid iCal format
4. **Wait for Sync**: Google Calendar can take 5-15 minutes to sync new subscriptions

### Events Not Showing

1. **Verify Events Exist**: Check that you have active groups with:
   - Birthday groups with members who have birthdays set
   - Subscription groups with deadlines configured
   - General groups with future deadlines

2. **Check Event Type Filter**: Make sure `eventType` parameter matches your groups

3. **Token Permissions**: Verify your token has access to the groups

### "Authentication required" Error

1. Ensure token is included in URL: `?token=YOUR_TOKEN`
2. Verify token hasn't expired
3. Check that the user account is active

### Testing the Feed

You can test the calendar feed directly in your browser:
```bash
# Replace YOUR_TOKEN with your actual JWT token
curl "https://your-domain.com/api/calendar/feed?token=YOUR_TOKEN"

# Should return iCal format starting with:
# BEGIN:VCALENDAR
# VERSION:2.0
# ...
```

## Technical Details

### iCal Format Compliance
- Follows RFC 5545 iCalendar specification
- Compatible with Google Calendar, Apple Calendar, Outlook, and other standard calendar apps
- Uses proper date formatting, event UIDs, and recurrence rules

### Caching
- Calendar feeds are cached with `Cache-Control: public, max-age=3600`
- Calendar apps will typically refresh every 1-24 hours automatically

### Security
- Authentication required for all calendar feeds
- Tokens can be passed in query parameter (for calendar app compatibility) or Authorization header
- User must be active member of groups to see events

## Example Calendar Feed Response

```ical
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//GroupFund//Calendar//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:GroupFund Calendar
X-WR-CALDESC:Birthdays and deadlines from GroupFund
X-WR-TIMEZONE:UTC
BEGIN:VEVENT
UID:birthday-123-456-20260117T120000Z@groupfund.app
DTSTAMP:20260117T120000Z
DTSTART;VALUE=DATE:20260215
DTEND;VALUE=DATE:20260216
SUMMARY:John's Birthday - Family Group
DESCRIPTION:Birthday reminder for John in Family Group. Contribution: NGN 5000
BEGIN:VALARM
TRIGGER:-P7D
ACTION:DISPLAY
DESCRIPTION:John's birthday is in 7 days
END:VALARM
BEGIN:VALARM
TRIGGER:-P1D
ACTION:DISPLAY
DESCRIPTION:John's birthday is in 1 day
END:VALARM
RRULE:FREQ=YEARLY;INTERVAL=1
END:VEVENT
END:VCALENDAR
```
