import { readFileSync, writeFileSync } from "fs";

/**
 * Version bump script with two modes:
 *
 * 1. npm version hook (default):
 *    Called automatically by `npm version` — reads the target version from
 *    process.env.npm_package_version and updates manifest.json + versions.json.
 *
 * 2. CI conventional-commits mode:
 *    Called with `--bump=major|minor|patch` — computes the next version from
 *    the current manifest.json version, then updates manifest.json,
 *    package.json, and versions.json.
 */

const bumpArg = process.argv.find((a) => a.startsWith("--bump="));
let targetVersion;

if (bumpArg) {
	// CI mode: compute new version from current + bump type
	const bumpType = bumpArg.split("=")[1];
	const current = JSON.parse(readFileSync("manifest.json", "utf8")).version;
	const [major, minor, patch] = current.split(".").map(Number);

	switch (bumpType) {
		case "major":
			targetVersion = `${major + 1}.0.0`;
			break;
		case "minor":
			targetVersion = `${major}.${minor + 1}.0`;
			break;
		case "patch":
			targetVersion = `${major}.${minor}.${patch + 1}`;
			break;
		default:
			console.error(`Unknown bump type: ${bumpType}`);
			process.exit(1);
	}

	// In CI mode also update package.json
	const pkg = JSON.parse(readFileSync("package.json", "utf8"));
	pkg.version = targetVersion;
	writeFileSync("package.json", JSON.stringify(pkg, null, "\t") + "\n");
} else {
	// npm version hook mode — package.json is already bumped by npm
	targetVersion = process.env.npm_package_version;
}

if (!targetVersion) {
	console.error(
		"No target version. Use --bump=major|minor|patch or run via npm version.",
	);
	process.exit(1);
}

// Update manifest.json
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

// Update versions.json — always add the new version entry
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");

console.log(`Bumped version to ${targetVersion}`);
