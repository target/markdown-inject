import { Console } from 'console'
import { Writable } from 'stream'

class Logger extends Console {
  constructor(quiet = false) {
    super(quiet ? new Writable() : process.stdout)
  }
}

export default Logger
