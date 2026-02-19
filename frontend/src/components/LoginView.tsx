/**
 * Login view — GitHub OAuth sign-in.
 */

export function LoginView() {
  return (
    <main id="app">
      <h1>VoxPilot</h1>
      <div id="login-view">
        <p>Sign in with GitHub to start chatting with AI models.</p>
        <a href="/api/auth/login" class="btn btn-github">
          Sign in with GitHub
        </a>
      </div>
    </main>
  );
}
