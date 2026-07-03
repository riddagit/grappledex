import { AthleteForm } from "./athlete-form";

export default function NewAthletePage() {
  return (
    <main style={{ maxWidth: 560, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>New athlete</h1>
      <AthleteForm />
    </main>
  );
}
