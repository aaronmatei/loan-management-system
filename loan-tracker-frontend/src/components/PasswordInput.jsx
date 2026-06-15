import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

// Password field with a show/hide eye toggle. Drop-in replacement for a plain
// <input type="password" …/> — pass the same props (value, onChange, placeholder,
// className, autoComplete, required…). The toggle is tabIndex=-1 so it doesn't
// interrupt keyboard flow through the form.
export default function PasswordInput({ className = "", ...props }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={show ? "text" : "password"} className={`${className} pr-11`} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        tabIndex={-1}
        aria-label={show ? "Hide password" : "Show password"}
        title={show ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-600"
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
