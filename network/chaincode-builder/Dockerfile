ARG GO_IMAGE=golang:1.26.10@sha256:cfa27959837144bf4649802ba38e59daffd0dd2a7994aa83daaf113285b0f551
FROM ${GO_IMAGE} AS patched-go
FROM hyperledger/fabric-ccenv:2.5.16@sha256:807493f095f65140ad4cd4543a824c9021a848c8c7aace9bec512e8545e870f1
USER root
ENV GOMAXPROCS=1 GOFLAGS=-p=1 GOMEMLIMIT=256MiB GOGC=50
RUN rm -rf /usr/local/go
COPY --from=patched-go /usr/local/go /usr/local/go
RUN /usr/local/go/bin/go version
