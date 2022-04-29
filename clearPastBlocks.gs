/**
* This script looks at past events that are named in specific ways (see, for example blockFromPersonalCalendar.gs),
* and deletes them
*/
function clearPastBlocks() {
  const anHourAgo = new Date(Date.now() - 1000*60*60);
  const startDate = new Date(Date.now() - 1000*60*60*24);
  const eventsToDelete = [
    '👨🏽‍💻 Code Cave Time',
    '❌ Busy',
    '📚 Reading/Watching',
  ];

  const calendar = CalendarApp.getDefaultCalendar();

  calendar
    .getEvents(startDate, anHourAgo)
    .filter((event) => eventsToDelete.includes(event.getTitle()))
    .forEach((event) => {
      console.log(`Deleting ${event.getStartTime().toLocaleString()}-${event.getEndTime().toLocaleString()} - ${event.getTitle()}`);
      event.deleteEvent();
    });
}
