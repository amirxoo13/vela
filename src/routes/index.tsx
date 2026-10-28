import { createFileRoute } from "@tanstack/react-router";
import { VelaApp } from "@/components/vela-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <VelaApp />;
}
