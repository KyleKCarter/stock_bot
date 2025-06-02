## Running the Project with Docker Compose

This project uses **Docker Compose** to run both the API server and the ORB worker as separate services.


### Prerequisites

- [Docker](https://www.docker.com/get-started) installed
- [Docker Compose](https://docs.docker.com/compose/install/) installed
- A `.env` file in the `backend` directory with all required environment variables
- Make sure to start Docker Desktop to run the following.


### How to Start

1. **Build and start the containers (first time or after dependency changes):**
    ```sh
    docker-compose up --build
    ```

2. **Start the containers (after the first build):**
    ```sh
    docker-compose up
    ```

3. **Stop the containers:**
    ```sh
    docker-compose down


### Running Only the ORB Worker with Docker Compose

If you want to start **only the ORB worker and VWAP worker** service (without starting the API server), use the service name defined in your `docker-compose.yml`:

```sh
docker compose up orbworker vwapworker
```
or, if you are using the legacy Docker Compose command:
```sh
docker-compose up orbworker vwapworker
```

This command will start only the `orbworker` service, which runs your scheduled trading logic, and will not start the API server.

**Note:**  
Use the service name (`orbworker`) from your `docker-compose.yml`, not the script filename.
    ```


### What Happens

- The **API server** runs in one container and is accessible on port `32224`.
- The **ORB worker** runs in a separate container and executes trading logic on schedule.
- Both containers share the same codebase and environment variables.


### When to Run `docker compose build`

You **need to run** `docker compose build` when:
- You install new dependencies (e.g., run `npm install <package>` and update `package.json`).
- You change the `Dockerfile`.
- You change files that are copied during the build (such as `package.json` or `package-lock.json`).

You **do NOT need to run** `docker compose build` when:
- You only change your application code (like `index.js`, `orbWorker.js`, or other JS files), unless your Dockerfile copies code only at build time and you want those changes reflected in the container.
- For most code changes, simply restarting the containers with `docker compose up` is sufficient if you are using volume mounts for development.

**Tip:**  
For production, always rebuild after changing dependencies or code. For development, consider using volume mounts to reflect code changes instantly without rebuilding.