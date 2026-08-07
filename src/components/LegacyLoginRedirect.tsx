"use client";

import { useEffect } from "react";
import styles from "./Marketplace.module.css";

export function LegacyLoginRedirect() {
  useEffect(() => {
    const destination = new URL("/sign-in/", window.location.origin);
    destination.search = window.location.search;
    destination.hash = window.location.hash;
    window.location.replace(destination.toString());
  }, []);

  return <div className={styles.loading}>Taking you to sign in...</div>;
}
