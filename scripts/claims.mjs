// Numbers a page or README states about the catalogue ("52 skills and 7 mods", "44 skills").
// drift_check matches names; a stated number is a separate claim that drifts on its own,
// because it is usually typed once and never regenerated.

const stripHtml = (s) =>
  s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// Every "N skills" in the text, with the mod count when the same phrase states one.
// Run-log phrases ("check_skill.py × 42 skills") are dated history, not a claim about now, so a
// count preceded by × or "on the" is returned with dated: true and reported as context only.
export function statedCounts(raw) {
  const text = /<\/?[a-z][\s\S]*>/i.test(raw) ? stripHtml(raw) : raw.replace(/\s+/g, " ");
  const out = [];
  const re = /(×\s*|\bon the\s+)?\b(\d{1,4})\s+skills?\b(?:\s+(?:and|·|\+|,)\s+(\d{1,4})\s+mods?\b)?/gi;
  for (const m of text.matchAll(re)) {
    out.push({ skills: +m[2], mods: m[3] === undefined ? undefined : +m[3], dated: Boolean(m[1]), at: m[0].trim() });
  }
  return out;
}

// Judge stated counts against the reference (the generated hub headline). A number equal to
// skills + mods is named as such: it is the commonest slip, counting mods as skills.
export function judgeCounts(claims, ref) {
  const findings = [];
  for (const c of claims) {
    if (c.dated) continue;
    if (c.skills === ref.skills && (c.mods === undefined || c.mods === ref.mods)) continue;
    let why = `expected ${ref.skills} skills` + (ref.mods ? ` and ${ref.mods} mods` : "");
    if (ref.mods && c.skills === ref.skills + ref.mods && c.mods === undefined) why += " (this is skills + mods counted as skills)";
    findings.push({ at: c.at, why });
  }
  return findings;
}

// Lines that still name a host the site has moved off.
export function retiredMentions(raw, hosts) {
  return hosts.filter((h) => h && raw.includes(h));
}
