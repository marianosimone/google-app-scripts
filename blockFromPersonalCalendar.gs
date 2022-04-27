/**
 * This script takes events from a calendar (pressumably personal), and blocks the times
 * in which there are events in another one (pressumably professional)
 * 
 * Adapated from https://github.com/marianosimone/google-app-scripts/blob/main/blockFromPersonalCalendar.gs.
 * My changes:
 * - handle multiple secondary calendars
 * - specify a color for the created events
 * 
 * This does not handle timezones at all, and just assumes that both calendars are on the same one
 * 
 * Configuration:
 * - Follow the instructions on https://support.google.com/calendar/answer/37082 to share your personal calendar with your work one
 * - In your work account, create a new https://script.google.com/ project, inside it a script, and paste the contents of this file
 * - Set a trigger for an hourly run of `blockFromPersonalCalendar` 
 */
const CONFIG = {
  calendarIds: ["mattkharris@gmail.com", "aqv06aedps4ek5pggj5ug1gots@group.calendar.google.com"], // (personal) calendars from which to block time
  daysToBlockInAdvance: 30, // how many days to look ahead for
  blockedEventTitle: '❌ Busy', // the title to use in the created events in the (work) calendar
  skipWeekends: true, // if weekend events should be skipped or not
  skipAllDayEvents: true, // don't block all-day events from the personal calendar
  workingHoursStartAt: 800, // any events ending before this time will be skipped. Use 0 if you don't care about working hours
  workingHoursEndAt: 1900, // any events starting after this time will be skipped. Use 2300
  assumeAllDayEventsInWorkCalendarIsOOO: true, // if the work calendar has an all-day event, assume it's an OOO day, and don't block times
  skipFreeAvailabilityEvents: true, // Ignore events that are marked as "Free" in the secondary calendar
  color: CalendarApp.EventColor.YELLOW // set the color of any newly created events (see https://developers.google.com/apps-script/reference/calendar/event-color)
}

function blockFromPersonalCalendars() {
  CONFIG.calendarIds.map((calendarId) => blockFromPersonalCalendar(calendarId));
}

function blockFromPersonalCalendar(calendarId) {
  console.log(`📆 Processing secondary calendar ${calendarId}`);
  
  const now = new Date();
  const endDate = new Date(Date.now() + 1000*60*60*24*CONFIG.daysToBlockInAdvance);
  
  const primaryCalendar = CalendarApp.getDefaultCalendar();
  
  const knownEvents = Object.assign({}, ...primaryCalendar.getEvents(now, endDate)
      .filter((event) => event.getTag(eventTag(calendarId)))
      .map((event) => ({[event.getTag(eventTag(calendarId))]: event})));

  const knownOutOfOfficeDays = new Set(
    primaryCalendar.getEvents(now, endDate)
      .filter((event) => event.isAllDayEvent())
      .map((event) => getRoughDay(event))
  );

  const secondaryCalendar = CalendarApp.getCalendarById(calendarId);
  secondaryCalendar.getEvents(now, endDate)
    .filter(withLogging('already known', (event) => !knownEvents.hasOwnProperty(event.getId())))
    .filter(withLogging('outside of work hours', (event) => isOutOfWorkHours(event)))
    .filter(withLogging('during a weekend', (event) => !CONFIG.skipWeekends || isInAWeekend(event)))
    .filter(withLogging('during an OOO day', (event) => !CONFIG.assumeAllDayEventsInWorkCalendarIsOOO || !knownOutOfOfficeDays.has(getRoughDay(event))))
    .filter(withLogging('an all day event', (event) => !CONFIG.skipAllDayEvents || !event.isAllDayEvent()))
    .forEach((event) => {
      console.log(`✅ Need to create "${event.getTitle()}" (${event.getStartTime()}) [${event.getId()}]`);
      const newEvent = primaryCalendar.createEvent(CONFIG.blockedEventTitle, event.getStartTime(), event.getEndTime());
      newEvent.setTag(eventTag(calendarId), event.getId());
      newEvent.setColor(CONFIG.color);
      newEvent.removeAllReminders(); // Avoid double notifications
    });

  const idsOnSecondaryCalendar = new Set(
    secondaryCalendar.getEvents(now, endDate)
      .map((event) => event.getId())
    );
  Object.values(knownEvents)
    .filter((event) => !idsOnSecondaryCalendar.has(event.getTag(eventTag(calendarId))))
    .forEach((event) => {
      console.log(`Need to delete event on ${event.getStartTime()}, as it was removed from personal calendar`);
      event.deleteEvent();
  });
}

// const COPIED_EVENT_TAG = 'blockFromPersonal.originalEventId';

const eventTag = (calendarId) => {
  const calendarIdShort = calendarId.substring(0,5);
  return `blockFromPersonal.${calendarIdShort}.originalEventId`;
}

// Get the day in which an event is happening, without paying attention to timezones
const getRoughDay = (event) => `${event.getStartTime().getFullYear()}${event.getStartTime().getMonth()}${event.getStartTime().getDate()}`;

const isInAWeekend = (event) => {
  const day = event.getStartTime().getDay();
      return day != 0 && day != 6;
}

const isOutOfWorkHours = (event) => {
  const startingDate = new Date(event.getStartTime().getTime())
  const startingTime = startingDate.getHours() * 100 + startingDate.getMinutes();
  const endingDate = new Date(event.getEndTime().getTime())
  const endingTime = endingDate.getHours() * 100 + endingDate.getMinutes();
  return startingTime < CONFIG.workingHoursEndAt && endingTime > CONFIG.workingHoursStartAt;
}

/** 
 * Wrapper for the filtering functions that logs why something was skipped
 */
const withLogging = (reason, fun) => {
  return (event) => {
    const result = fun.call(this, event);
    if (!result) {
      console.info(`ℹ️ Skipping "${event.getTitle()}" (${event.getStartTime()}) because it's ${reason}`)
    };
    return result;
  }
}
