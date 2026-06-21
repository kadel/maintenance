{
  description = "Maintenance scripts for GitHub repositories";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        catalog-validate = pkgs.writeShellApplication {
          name = "catalog-validate";
          runtimeInputs = [ pkgs.nodejs_22 pkgs.gh ];
          text = ''
            exec node --experimental-strip-types \
              "${self}/catalog-info/validate-catalog.ts" "$@"
          '';
        };
      in {
        packages.default = catalog-validate;
        packages.catalog-validate = catalog-validate;

        apps.default = {
          type = "app";
          program = "${catalog-validate}/bin/catalog-validate";
        };

        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.nodejs_22
            pkgs.gh
            pkgs.git
          ];

          shellHook = ''
            npm install
          '';
        };
      });
}
