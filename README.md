# k6-flareon-dockerized-test

## Manual

Kontener odpalamy poprzez komendę:

```
docker run --rm -v $(pwd)/logs:/logs -e TEST_SCRIPT=4f_flareon_preprod k6-flareon-test
```

Zmienna środowiskowa TEST_SCRIPT wybiera nam test do wywołania
