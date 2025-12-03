FROM denoland/deno:2.5.6

WORKDIR /app

COPY deno.json deno.lock ./
COPY config.yaml ./
COPY main.ts ./
COPY src ./src

RUN deno cache main.ts

CMD [ "deno", "run", "--allow-net", "--allow-read=./config.yaml,/tmp/artifacts", "--allow-write=/tmp/artifacts", "--allow-env=DB_HOST,DB_NAME,DB_USER,DB_PASSWORD", "main.ts"]