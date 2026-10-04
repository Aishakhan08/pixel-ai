export const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
export const absUrl = (u) => (u.startsWith("http") ? u : API + u);

export async function saveAll(results, prefix) {
  for (const [i, r] of results.entries()) {
    const blob = await (await fetch(absUrl(r.outputUrl))).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${prefix}-${i + 1}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
}
