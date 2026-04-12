import { redirect } from "next/navigation";
export default function CaptureRedirect() {
  redirect("/dashboard/tasks");
}
