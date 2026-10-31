export default function NavigationIcon({
  name,
  filled = false,
}: {
  name: "profile" | "heart" | "bag" | "location" | "search";
  filled?: boolean;
}) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill={name === "heart" && filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "profile" && (
        <>
          <circle cx="12" cy="7" r="3.5" />
          <path d="M4 21v-2a8 8 0 0 1 16 0v2Z" />
        </>
      )}
      {name === "heart" && (
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
      )}
      {name === "bag" && (
        <>
          <path d="M4 8h16l-1 13H5L4 8Z" />
          <path d="M8 9V6a4 4 0 0 1 8 0v3" />
        </>
      )}
      {name === "location" && (
        <>
          <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
          <circle cx="12" cy="10" r="2.5" />
        </>
      )}
      {name === "search" && (
        <>
          <circle cx="10.5" cy="10.5" r="7.5" />
          <path d="m16 16 5 5" />
        </>
      )}
    </svg>
  );
}
