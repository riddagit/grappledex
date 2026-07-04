import { EventForm } from "./event-form";

export default function NewEventPage() {
  return (
    <main style={{ maxWidth: 560, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>New event</h1>
      <EventForm />
    </main>
  );
}
