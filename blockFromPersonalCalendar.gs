/**
 * This script takes events from a calendar (pressumably personal), and blocks the times
 * in which there are events in another one (pressumably professional)
 * 
 * Given the assumptions, there are some things configured by default:
 * - Skip weekends
 * - Assume that "all day" events in the professional calendar mean OOO, so skip any events on those days
 */
const CONFIG = {
  calendarId: "marianosimone@gmail.com",
  daysToBlockInAdvance: 30,
  blockedEventTitle: '❌ Busy',
}

// Get the day in which an event is happening, without paying attention to timezones
const getRoughDay = (event) => `${event.getStartTime().getFullYear()}${event.getStartTime().getMonth()}${event.getStartTime().getDate()}`;

function blockFromPersonalCalendar() {
  const now = new Date();
  const endDate = new Date(Date.now() + 1000*60*60*24*CONFIG.daysToBlockInAdvance);
  
  const primaryCalendar = CalendarApp.getDefaultCalendar();
  const knownEventsStartTimes = new Set(
    primaryCalendar.getEvents(now, endDate)
      .filter((event) => event.getTitle() === CONFIG.blockedEventTitle)
      .map((event) => event.getStartTime().toUTCString())
  );

  const knownOutOfOfficeDays = new Set(
    primaryCalendar.getEvents(now, endDate)
      .filter((event) => event.isAllDayEvent())
      .map((event) => getRoughDay(event))
  );

  const secondaryCalendar = CalendarApp.getCalendarById(CONFIG.calendarId);
  secondaryCalendar.getEvents(now, endDate)
    .filter((event) => !knownEventsStartTimes.has(event.getStartTime().toUTCString()))
    .filter((event) => {
      const day = event.getStartTime().getDay();
      return day != 0 && day != 6;
    })
    .filter((event) => !knownOutOfOfficeDays.has(getRoughDay(event)))
    .filter((event) => !event.isAllDayEvent())
    .forEach((event) => {
      console.log("Need to create an event!", event.getTitle(), event.getStartTime());
      const newEvent = primaryCalendar.createEvent(CONFIG.blockedEventTitle, event.getStartTime(), event.getEndTime());
      newEvent.removeAllReminders(); // Avoid double notifications
    });
}
