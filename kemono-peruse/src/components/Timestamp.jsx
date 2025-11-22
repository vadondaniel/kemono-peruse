import React from "react";

import { formatDate } from "../utils/date";

function Timestamp({ value, prefix }) {
  const { date, time } = formatDate(value);
  if (!date) return null;
  const label = typeof prefix === "string" ? prefix.trim() : "";
  return (
    <span className="timestamp">
      {label ? <span className="timestamp-label">{label}</span> : null}
      <span className="timestamp-date">{date}</span>
      {time ? <span className="timestamp-time">{time}</span> : null}
    </span>
  );
}

export default Timestamp;
