/**
 * This script takes events from a list of calendars (pressumably personal), and blocks the times
 * in which there are events in another one (pressumably professional)
 * 
 * This does not handle timezones at all, and just assumes that both calendars are on the same one
 * 
 * Configuration:
 * - Follow the instructions on https://support.google.com/calendar/answer/37082 to share your personal calendar with your work one
 * - In your work account, create a new https://script.google.com/ project, inside it a script, and paste the contents of this file
 * - Set a trigger for an hourly run of `blockFromPersonalCalendars` 
 */
const CONFIG = {
  calendarIds: ["mypersonalcalendar@gmail.com", "anothercalendarid@group.calendar.google.com"], // (personal) calendars from which to block time
  daysToBlockInAdvance: 30, // how many days to look ahead for
  blockedEventTitle: '❌ Busy', // the title to use in the created events in the (work) calendar
  skipWeekends: true, // if weekend events should be skipped or not
  skipAllDayEvents: true, // don't block all-day events from the personal calendar
  workingHoursStartAt: 900, // any events ending before this time will be skipped. Use 0 if you don't care about working hours
  workingHoursEndAt: 1800, // any events starting after this time will be skipped. Use 2300
  assumeAllDayEventsInWorkCalendarIsOOO: true, // if the work calendar has an all-day event, assume it's an OOO day, and don't block times
  skipFreeAvailabilityEvents: true, // Ignore events that are marked as "Free" in the secondary calendar
  color: CalendarApp.EventColor.YELLOW // set the color of any newly created events (see https://developers.google.com/apps-script/reference/calendar/event-color)
}

function blockFromPersonalCalendars() {
  CONFIG.calendarIds.forEach(blockFromPersonalCalendar);
}

function blockFromPersonalCalendar(calendarId) {
  console.log(`📆 Processing secondary calendar ${calendarId}`);
  const copiedEventTag = `blockFromPersonal.${calendarId.split('@')[0]}.originalId`;

  const now = new Date();
  const endDate = new Date(Date.now() + 1000*60*60*24*CONFIG.daysToBlockInAdvance);
  
  const primaryCalendar = CalendarApp.getDefaultCalendar();
  
  const knownEvents = Object.assign({}, ...primaryCalendar.getEvents(now, endDate)
      .filter((event) => event.getTag(copiedEventTag))
      .map((event) => ({[event.getTag(copiedEventTag)]: event})));

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
      newEvent.setTag(copiedEventTag, event.getId());
      newEvent.setColor(CONFIG.color);
      newEvent.removeAllReminders(); // Avoid double notifications
    });

  const idsOnSecondaryCalendar = new Set(
    secondaryCalendar.getEvents(now, endDate)
      .map((event) => event.getId())
    );
  Object.values(knownEvents)
    .filter((event) => !idsOnSecondaryCalendar.has(event.getTag(copiedEventTag)))
    .forEach((event) => {
      console.log(`Need to delete event on ${event.getStartTime()}, as it was removed from personal calendar`);
      event.deleteEvent();
  });
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
