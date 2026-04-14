import messages from '../messages/ko/index'

type Messages = typeof messages

declare global {
  interface IntlMessages extends Messages {}
}
