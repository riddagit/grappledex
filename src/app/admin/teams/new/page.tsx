import { TeamForm } from "./team-form";

export default function NewTeamPage() {
  return (
    <main style={{ maxWidth: 560, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>New team</h1>
      <TeamForm />
    </main>
  );
}
