const words = (value) =>
  String(value || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

export function suggestHandoffLaneId(stepText, lanes) {
  const text = words(stepText);
  const matches = lanes.filter((lane) => {
    const [first, ...rest] = words(lane.name);
    if (!first) return false;
    const forms = [first, first + "ovi"];
    if (/[iy]$/.test(first)) forms.push(first.slice(0, -1) + "emu");
    return text.some((word, index) =>
      forms.includes(word) && rest.every((part, offset) => part === text[index + offset + 1]),
    );
  });
  return matches.length === 1 ? matches[0].id : "";
}
