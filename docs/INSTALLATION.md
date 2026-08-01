# Install and verify the plugin

`sf-plugin-data360` is currently a beta plugin. The npm owner and final published package name are still release decisions, so don't treat an npm install command as available until a release announcement names the package and version.

The supported runtime is Node.js 22.19+ in the 22.x line or Node.js 24, plus a current Salesforce CLI. The installed package declares this engine range and the CI/package smoke uses it.

## Develop or test from source

```shell
git clone https://github.com/dsouza-anush/sf-plugin-data360.git
cd sf-plugin-data360
corepack enable
yarn install --frozen-lockfile
yarn build
sf plugins link .
sf data360 --help
sf data360 doctor --target-org my-org
```

Run `sf plugins` to confirm that the linked plugin points to this checkout. Re-run `yarn build` after changing source or message files.

## Install a published release

After the package owner publishes a release, use the exact package name and a pinned version from the release notes:

```shell
sf plugins install <published-package-name>@<version>
sf plugins inspect <published-package-name>
sf data360 --help
sf data360 doctor --target-org my-org
```

Third-party Salesforce CLI plugins aren't digitally signed by Salesforce. The CLI therefore asks you to confirm the first install. Review the package source and release provenance before accepting the prompt.

For an unattended installation, pin the reviewed version and explicitly answer the trust prompt:

```shell
printf 'y\n' | sf plugins install <published-package-name>@<version>
```

An enterprise can instead add the exact published package name to `unsignedPluginAllowList.json` in the Salesforce CLI configuration directory. Follow Salesforce's [unsigned-plugin allowlist guidance](https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_allowlist.htm) and manage the file through the organization's endpoint-management policy.

## Update or uninstall

```shell
sf plugins update
sf plugins uninstall <published-package-name>
sf plugins
```

After an update, run `sf data360 doctor --target-org my-org` and a read-only command used by your workflow. CI should continue to pin an exact version and advance it through normal dependency review.
