import ko from '../messages/ko.json'

type Messages = typeof ko

declare global {
  interface IntlMessages extends Messages {}
}
