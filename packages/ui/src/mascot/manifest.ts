// PIKAS mascot manifest, typed. The JSON is the shipped copy of docs/pikas-mascot-system/brand/mascot/manifest.json
// (kept identical by scripts/sync-mascot.mjs --check). Ids, size ranges, motion files and alt text come from here;
// components never hard-code them.
import manifestJson from "../../assets/mascot/manifest.json";

export type MascotSet = "foundation" | "success" | "onboarding" | "cafeteria" | "pos" | "finance" | "attention" | "support" | "empty-states" | "demo";
export type MascotAsset = {
  id: string; name: string; file: string; set: MascotSet | string; cap: boolean; prop: string | null; contexts: string[]; use: string;
  sizePx: string; motionFile: string | null; altWhenMeaningful: string | null; never: string | null;
};
export type MascotMotion = { id: string; name: string; file: string; timing: string; notes: string };
export type MascotManifest = { version: string; generated: string; basePath: string; rules: { decorativeByDefault: boolean; hatOnSets: string[]; minSizePx: number; noMascot: string[] }; assets: MascotAsset[]; motion: MascotMotion[] };

export const manifest = manifestJson as unknown as MascotManifest;
export const assetsById: ReadonlyMap<string, MascotAsset> = new Map(manifest.assets.map(a => [a.id, a]));
export type MascotId = (typeof manifestJson)["assets"][number]["id"];
export const sizeRange = (asset: MascotAsset): [number, number] => { const [min, max] = asset.sizePx.split("-").map(Number); return [Math.max(manifest.rules.minSizePx, min || 0), max || Infinity]; };
