// This is a google apps script to automatically create time blocks on your calendar
// after interviews to give you time between meetings to fill out scorecard feedback.
// It also gives you a link to the scorecard in the event location.
//
// It's very simple in that it only schedules a block if there isn't already an event
// in that timeslot (this doubles as an idempotency mechanism since this script runs
// repeatedly).
//
// To use it, create a new script at https://script.google.com/ on your Stripe account
// and click "+" in Services menu, then add the Google Calendar API v3. Paste in this
// script to the code editor and set up a time-based trigger in the Triggers tab.
//
// The size of the interview block is configurable (right below this line)
const TIME_BLOCK_MINS = 15;

const isInterviewEvent = (event) => {
  if (event.getTitle().includes('Team Screen')) return true;
  if (event.getDescription().includes('Thanks for interviewing')) return true;
  if (event.getGuestList().find(guest => guest.getName().includes('GoodTime Sync'))) return true;

  return false;
}

const hasSpaceForBlockAfter = (cal, eventEnds, timeBlockEnds) => {
  const existingEvents = cal.getEvents(eventEnds, timeBlockEnds);
  const existingNotAllDayEvents = existingEvents.filter(evt => !evt.isAllDayEvent())
  return existingNotAllDayEvents.length === 0; // Don't schedule if there's something there already
}

const getScorecardLink = (event) => {
  // This is a lazy regex; contributions welcome
  const link = event.getDescription().match(/https:\/\/app.greenhouse.io\/guides\/[^ <"]+/);
  return link ? link[0] : "";
}

const eventCancelled = (cal, event) => {
  // This is stupid but you can't check if events have been deleted
  // without reaching into the "real" Google Calendar API
  const eventId = event.getId().split("@")[0]; // gcal api only utilizes the first part of the id
  return Calendar.Events.get(cal.getId(), eventId).status === "cancelled";
}

const interviewInOriginalSpot = (cal, event, interviewId) => {
  const interview = cal.getEventById(interviewId);
  if (!interview) {
    console.log(`Couldn't find event with ID ${interivewId}; assuming event still exists to be safe`);
    return true; // fail closed if we can't find the interview event tagged on the scorecard block
  }

  if (eventCancelled(cal, interview)) {
    return false; // interview cancelled
  }

  if (interview.getEndTime().getTime() !== event.getStartTime().getTime()) {
    return false; // interview rescheduled
  }

  return true; // interview still in original spot
}

// Tag for tracking events created by this script
const SCORECARD_TAG = "interview_scorecard_autoscheduled";

// Wrapper for deleting interview blocks that guarantees we
// _only_ delete interview blocks scheduled by this script,
// even if the surrounding logic changes
const deleteInterviewBlock = (event) => {
  if (
    !event.getAllTagKeys().includes(SCORECARD_TAG) // has tag
    || !event.getTag(SCORECARD_TAG) // tag is non-null
    || event.getTag(SCORECARD_TAG).length === 0 // tag has content set
  ) {
    console.log(`skipping bad event deletion for ${event.getTitle()}`);
    return;
  }

  console.log(`deleting ${event.getTitle()}`);
  event.deleteEvent();
}

function scheduleInterviewFeedback() {
  const today = new Date();
  const twoWeeksFromNow = new Date(Date.now() + (14 * 24 * 60 * 60 * 1000));

  const cal = CalendarApp.getDefaultCalendar();
  const myEvents = cal.getEvents(today, twoWeeksFromNow);

  myEvents.forEach(event => {
    // If this is an event we've created in the past, check if the interview
    // has been canceled or rescheduled and we need to remove the block
    const eventData = event.getTag(SCORECARD_TAG);
    if (eventData && eventData.length > 0 && !interviewInOriginalSpot(cal, event, eventData)) {
      deleteInterviewBlock(event);
    }

    const eventEnds = event.getEndTime()
    const timeBlockEnds = new Date(eventEnds.getTime() + TIME_BLOCK_MINS*60000);

    if (isInterviewEvent(event) && hasSpaceForBlockAfter(cal, eventEnds, timeBlockEnds)) {
      const location = getScorecardLink(event);
      const createdEvent = cal.createEvent(
        "Fill out interview scorecard",
        eventEnds,
        timeBlockEnds,
        {
          "location": location,
          "description": "Generated with https://git.corp.stripe.com/cameron/scripts/blob/master/scorecard.js",
        }
      );
      createdEvent.setTag(SCORECARD_TAG, event.getId());
    }
  })
}