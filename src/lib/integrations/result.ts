export type StepResult = {
  status: "sent" | "skipped" | "failed";
  detail: string;
  ref?: string | null;
};

export const skipped = (detail: string): StepResult => ({ status: "skipped", detail });

export async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return `${res.status} ${res.statusText}${text ? `: ${text.slice(0, 500)}` : ""}`;
}
