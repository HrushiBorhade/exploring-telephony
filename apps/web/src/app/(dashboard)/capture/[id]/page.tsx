import { redirect } from "next/navigation";
export default async function CaptureDetailRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/tasks/${id}`);
}
