import { useState, useEffect, useCallback } from 'react'

interface ITimerProps {
  initialTime: number
}

interface ITimerMethods {
  timeLeft: number
  start: () => void
  stop: () => void
  reset: () => void
  pause: () => void
}

const useTimer = ({ initialTime }: ITimerProps): ITimerMethods => {
  const [timeLeft, setTimeLeft] = useState(initialTime)
  const [isActive, setIsActive] = useState(false)
  const [isPaused, setIsPaused] = useState(false)

  const start = useCallback(() => {
    setIsActive(true)
    setIsPaused(false)
  }, [])

  const stop = useCallback(() => {
    setIsActive(false)
    setIsPaused(false)
    setTimeLeft(initialTime)
  }, [initialTime])

  const reset = useCallback(() => {
    setTimeLeft(initialTime)
  }, [initialTime])

  const pause = useCallback(() => {
    setIsPaused(true)
    setIsActive(false)
  }, [])

  useEffect(() => {
    let intervalId: NodeJS.Timeout

    if (isActive && !isPaused) {
      intervalId = setInterval(() => {
        setTimeLeft((prevTime) => {
          const newTime = prevTime > 0 ? prevTime - 1 : 0

          if (newTime === 0) {
            setIsActive(false)
            clearInterval(intervalId)
          }

          return newTime
        })
      }, 1000)
    }

    return () => clearInterval(intervalId)
  }, [isActive, isPaused])

  return { timeLeft, start, stop, reset, pause }
}

export { useTimer }
