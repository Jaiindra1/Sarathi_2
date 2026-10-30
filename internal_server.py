"""Internal Python entry point. Public requests must go through Express."""
from threading import Event, Thread
import signal

from config.internal import load_config
from internal_api import create_internal_app
from services.search_jobs import search_jobs

config = load_config()
app = create_internal_app(config)


def run():
    from werkzeug.serving import make_server
    server = make_server(config.host, config.port, app, threaded=True)
    stop = Event()
    def request_stop(signum, frame):
        search_jobs.stop_accepting()
        stop.set()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, request_stop)
    thread = Thread(target=server.serve_forever, name="internal-http", daemon=True)
    thread.start()
    print(f"Python internal service listening on {config.host}:{config.port}", flush=True)
    try:
        stop.wait()
    finally:
        search_jobs.stop_accepting()
        server.shutdown()
        server.server_close()
        thread.join()
        # Complete active work normally; no unsafe cancellation of WebDriver.
        search_jobs.close()


if __name__ == "__main__":
    run()
