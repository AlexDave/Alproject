"use client";

export function LogoutButton() {
  return (
    <button
      className="agent-hub-linkbtn"
      type="button"
      onClick={async () => {
        await fetch("/api/agent-hub/logout", { method: "POST", credentials: "same-origin" });
        window.location.href = "/agent-hub/login";
      }}
    >
      Выйти
    </button>
  );
}
