ARG GO_IMAGE=golang:1.26.11@sha256:4165ee6bf3b7811fd7b40373290405c83d0167dcb87ee5f29c427cdcef45ff8f
FROM ${GO_IMAGE} AS patched-go
FROM hyperledger/fabric-ccenv:2.5.16@sha256:807493f095f65140ad4cd4543a824c9021a848c8c7aace9bec512e8545e870f1
USER root
ENV GOTOOLCHAIN=local GOMAXPROCS=1 GOFLAGS=-p=1 GOMEMLIMIT=256MiB GOGC=50
RUN rm -rf /usr/local/go
COPY --from=patched-go /usr/local/go /usr/local/go
RUN /usr/local/go/bin/go version
