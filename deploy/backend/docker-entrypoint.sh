#!/bin/sh
set -eu
texpad-migrate
exec texpad-server
