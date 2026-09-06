# Verification results

Run the repository verification from Windows PowerShell:

```powershell
.\scripts\verify-all.ps1
```

The runner checks web linting, strict types, unit tests, dependency advisories,
the production build, Dockerized Go chaincode tests, the live Fabric network and
committed contract, and the Microsoft Edge browser suite. The browser suite
creates uniquely named local ledger records as part of its end-to-end workflow.

`latest.json` is generated after each run and intentionally ignored by Git. Its
schema records the verified commit and branch, whether the tested tree was dirty,
which optional gates were included, runtime versions, step outcomes, and timing.
Use
`-SkipNetwork`, `-SkipBrowser`, or `-SkipAudit` only for focused offline checks;
a release/demo candidate should pass the complete default command.
