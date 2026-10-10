"use client";

import { useEffect, useState } from "react";

const KEY = "lcms.editorName";

/** No logins, so the price log records whichever name this browser last used. */
export function useEditorName(): [string, (v: string) => void] {
  const [name, setName] = useState("Nikhil");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setName(saved);
    } catch {
      /* storage blocked - keep default */
    }
  }, []);
  const update = (v: string) => {
    setName(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* ignore */
    }
  };
  return [name, update];
}
