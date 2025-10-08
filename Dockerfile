FROM grafana/k6:latest

WORKDIR /tests

COPY tests/ .

USER root
RUN mkdir -p /logs

USER k6
ENTRYPOINT [ "sh", "-c" ]
CMD ["k6 run /tests/${TEST_SCRIPT:-4f_flareon_preprod.js} --out json=/logs/results.json | tee /logs/test_output.log"]
