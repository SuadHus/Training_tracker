import { Opener, TextRow } from "../_parts/opener";

export const metadata = { title: "Privacy" };

export default function Privacy() {
  return <>
    <Opener><h1>Privacy</h1></Opener>
    <TextRow>
      <div className="prose">
        <p>Visitors can browse completed workouts, upcoming planned workouts, public day vitals, and published journal posts without an account.</p>
        <p>Choosing the light or the dark theme stores that choice in a cookie on your device.</p>
        <p>Google sign-in identifies the owner and sets a session cookie. The owner can separately connect Google Health for resting heart rate and sleep, and Withings for morning scale weight. The app uses these connections to review and, when enabled, show the corresponding daily summaries on the home page and workout pages.</p>
        <p>The app stores health observations and authorization credentials on the server. Connection credentials are encrypted. The owner can disconnect either provider and remove its imported observations from the Connections page.</p>
        <p>Public workout and journal pages are accessible to anyone and may be copied or indexed.</p>
      </div>
    </TextRow>
  </>;
}
