/**
 * This script takes events from a list of calendars (pressumably personal), and blocks the times
 * in which there are events in another one (pressumably professional)
 *
 * Configuration:
 * - Follow the instructions on https://support.google.com/calendar/answer/37082 to share your personal calendar with your work one
 * - In your work account, create a new https://script.google.com/ project, inside it a script, and paste the contents of this file
 * - Add "Calendar" to the *Services* section
 * - Set a trigger for an hourly run of `blockFromPersonalCalendars`
 *
 * Developer reference: https://developers.google.com/apps-script/reference/calendar/
 */
const CONFIG = {
  calendarIds: ["mypersonalcalendar@gmail.com", "anothercalendarid@group.calendar.google.com"], // (personal) calendars from which to block time
  daysToBlockInAdvance: 30, // how many days to look ahead for
  blockedEventTitle: '❌ Busy', // the title to use in the created events in the (work) calendar
  skipWeekends: true, // if weekend events should be skipped or not
  skipFreeAvailabilityEvents: true, // don't block events that set visibility as "Free" in the personal calendar
  workingHoursStartAt: 900, // any events ending before this time will be skipped. Use 0 if you don't care about working hours
  workingHoursEndAt: 1800, // any events starting after this time will be skipped. Use 2300
  assumeAllDayEventsInWorkCalendarIsOOO: true, // if the work calendar has an all-day event, assume it's an Out Of Office day, and don't block times
  color: CalendarApp.EventColor.YELLOW // set the color of any newly created events (see https://developers.google.com/apps-script/reference/calendar/event-color)
}

const blockFromPersonalCalendars = () => {
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

  /**
  * Utility class to  make sure that, when comparing events in a Personal calendar with the Work calendar
  * configuration, things like days and working hours are respected.
  *
  * The trick is that JS stores dates as UTC. Transforming dates to the work calendar's tz as a string, and then back
  * to a Date object, ensures that the absolute numbers for day/hour/minute maintained, which is what we use in the configuration.
  */
  const CalendarAwareTimeConverter = (calendar) => {

    // Load moment.js to be able to do date operations
    eval(UrlFetchApp.fetch('https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/moment.min.js').getContentText());
    eval(UrlFetchApp.fetch('https://cdnjs.cloudflare.com/ajax/libs/moment-timezone/0.5.41/moment-timezone-with-data.min.js').getContentText());

    const timeZone =  calendar.getTimeZone();
    const offsetedDate = (date) => moment(date).tz(timeZone);
    
    return {
      isInAWeekend: (event) => {
        const day = offsetedDate(event.getStartTime()).day();
        return day != 0 && day != 6;
      },
      isOutOfWorkHours: (event) => {
        const startingDate = offsetedDate(event.getStartTime());
        const startingTime = startingDate.hour() * 100 + startingDate.minute();
        const endingDate = offsetedDate(event.getEndTime());
        const endingTime = endingDate.hour() * 100 + endingDate.minute();
        return startingTime < CONFIG.workingHoursEndAt && endingTime > CONFIG.workingHoursStartAt;
      },
      day: (event) => {
        const startTime = offsetedDate(event.getStartTime());
        return `${startTime.year()}${startTime.month()}${startTime.date()}`;
      }
    }
  }

  /**
   * Helper to merge results from using CalendarApp and the advanced API
   * This is inefficient, but gets the best of both worlds: nice JS objects from
   * CalendarApp, and the `transparency` property from the API. If CalendarApp starts
   * exposing that in the future, there won't be a need to continue doing this.
   */
  const getRichEvents = (calendarId, start, end) => {
    const secondaryCalendar = CalendarApp.getCalendarById(calendarId);
    if (!secondaryCalendar) {
      throw `Couldn't load calendar for ${calendarId}. Check that ${CalendarApp.getName()} has access to it.`;
    }
    const richEvents = secondaryCalendar.getEvents(start, end);
    const freeAvailabilityEvents = new Set(
      Calendar.Events.list(calendarId, {timeMin: start.toISOString(), timeMax: end.toISOString()})
        .items
        .filter((event) => event.transparency === 'transparent')
        .map((event) => event.iCalUID)
    );
    richEvents.forEach((event) => {
      event.showFreeAvailability = freeAvailabilityEvents.has(event.getId());
    })
    return richEvents;
  }

  const eventTagValue = (event) => `${event.getId()}-${event.getStartTime().toISOString()}`;

  const hasTimeChanges = (event, knownEvent) => {
    const eventStartTime = event.getStartTime();
    const knownEventStartTime = knownEvent.getStartTime();
    const eventEndTime = event.getEndTime();
    const knownEventEndTime = knownEvent.getEndTime();
    return eventStartTime.valueOf() !== knownEventStartTime.valueOf() || eventEndTime.valueOf() !== knownEventEndTime.valueOf();
  }

  CONFIG.calendarIds.forEach((calendarId) => {
    console.log(`📆 Processing secondary calendar ${calendarId}`);

    const copiedEventTag = calendarEventTag(calendarId);

    const now = new Date();
    const endDate = new Date(Date.now() + 1000*60*60*24*CONFIG.daysToBlockInAdvance);

    const primaryCalendar = CalendarApp.getDefaultCalendar();
    const timeZoneAware = CalendarAwareTimeConverter(primaryCalendar);

    const knownEvents = Object.assign({}, ...primaryCalendar.getEvents(now, endDate)
        .filter((event) => event.getTag(copiedEventTag))
        .map((event) => ({[event.getTag(copiedEventTag)]: event})));

    const knownOutOfOfficeDays = new Set(
      primaryCalendar.getEvents(now, endDate)
        .filter((event) => event.isAllDayEvent() && event.getMyStatus() === 'YES')
        .map((event) => timeZoneAware.day(event))
    );

    const eventsInSecondaryCalendar = getRichEvents(calendarId, now, endDate);

    eventsInSecondaryCalendar
      .filter(withLogging('already known', (event) => {
        return !knownEvents.hasOwnProperty(eventTagValue(event)) || hasTimeChanges(event, knownEvents[eventTagValue(event)]);
      }))
      .filter(withLogging('outside of work hours', (event) => timeZoneAware.isOutOfWorkHours(event)))
      .filter(withLogging('during a weekend', (event) => !CONFIG.skipWeekends || timeZoneAware.isInAWeekend(event)))
      .filter(withLogging('during an OOO day', (event) => !CONFIG.assumeAllDayEventsInWorkCalendarIsOOO || !knownOutOfOfficeDays.has(timeZoneAware.day(event))))
      .filter(withLogging('marked as "Free" availabilty or is full day', (event) => !CONFIG.skipFreeAvailabilityEvents || !event.showFreeAvailability))
      .forEach((event) => {
        const knownEvent = knownEvents[eventTagValue(event)];
        if (knownEvent) {
          console.log(`📝 Need to edit "${event.getTitle()}" (${event.getStartTime()}) [${event.getId()}]`);
          knownEvent.deleteEvent();
        } else {
          console.log(`✅ Need to create "${event.getTitle()}" (${event.getStartTime()}) [${event.getId()}]`);
        }
        primaryCalendar.createEvent(CONFIG.blockedEventTitle, event.getStartTime(), event.getEndTime())
          .setTag(copiedEventTag, eventTagValue(event))
          .setColor(CONFIG.color)
          .removeAllReminders(); // Avoid double notifications
      });

    const tagsOnSecondaryCalendar = new Set(eventsInSecondaryCalendar.map(eventTagValue));
    Object.values(knownEvents)
      .filter((event) => !tagsOnSecondaryCalendar.has(event.getTag(copiedEventTag)))
      .forEach((event) => {
        console.log(`🗑️ Need to delete event on ${event.getStartTime()}, as it was removed from personal calendar`);
        event.deleteEvent();
    });
  });
}

const calendarEventTag  = (calendarId) => {
    const calendarHash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, calendarId));
    // This is undocumented, but keys fail if they are longer than 44 chars :)
    // The idea behind the SHA is to avoid collisions of the substring when you have similarly-named calendars
    return `blockFromPersonal.${calendarHash.substring(0, 15)}.originalId`;
}

/**
 * Utility function to remove all synced events. This is specially useful if you change configurations,
 * or are doing some testing
 */
const cleanUpAllCalendars = () => {
  const now = new Date();
  const endDate = new Date(Date.now() + 1000*60*60*24*CONFIG.daysToBlockInAdvance);
  const tagsOfEventsToDelete = new Set(CONFIG.calendarIds.map(calendarEventTag));

  CalendarApp.getDefaultCalendar()
    .getEvents(now, endDate)
    .filter((event) => event.getAllTagKeys().some((tag) => tagsOfEventsToDelete.has(tag)))
    .forEach((event) => {
      console.log(`🗑️ Need to delete event on ${event.getStartTime()} as part of cleanup`);
      event.deleteEvent()
    });
}
